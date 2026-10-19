"""Validate contracts, foreign keys, immutable snapshots, and derived review state."""
from __future__ import annotations

from collections import Counter
from copy import deepcopy
from datetime import datetime
import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

from build_content import digest, write_json

HERE = Path(__file__).resolve().parent


def require(condition, message):
    if not condition:
        raise ValueError(message)


def load(name):
    return json.loads((HERE / name).read_text())


def schema_check(value, definition):
    base = load('schema/data-contract.schema.json')
    Draft202012Validator.check_schema(base)
    schema = {'$schema': base['$schema'], '$defs': base['$defs'],
              '$ref': '#/$defs/' + definition}
    errors = sorted(Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(value),
                    key=lambda error: str(list(error.path)))
    if errors:
        error = errors[0]
        raise ValueError(f'{definition}: {list(error.path)}: {error.message}')


def index(items, label):
    result = {item['id']: item for item in items}
    require(len(result) == len(items), f'duplicate {label} IDs')
    return result


def revision_check(entity):
    require(entity['revision'] == digest({k: v for k, v in entity.items() if k != 'revision'}),
            f'revision mismatch: {entity["id"]}')


def question_check(q, pages=None, concepts=None, chapters=None):
    schema_check(q, 'question')
    revision_check(q)
    if pages is not None:
        require(set(q['source_page_ids']) <= pages.keys(), f'unknown source page: {q["id"]}')
    if concepts is not None:
        require(set(q['concept_ids']) <= concepts.keys(), f'unknown concept: {q["id"]}')
    if chapters is not None:
        require(set(q['chapter_ids']) <= chapters.keys(), f'unknown chapter: {q["id"]}')
    if q['format'] == 'single_choice':
        option_ids = {o['id'] for o in q['options']}
        require(len(option_ids) == 4, f'duplicate option IDs: {q["id"]}')
        require(option_ids == {f'{q["id"]}:{letter}' for letter in 'ABCD'},
                f'option owner mismatch: {q["id"]}')
        require(q['correct_option_id'] in option_ids, f'unknown correct option: {q["id"]}')
        require(len({o['text'].strip().casefold() for o in q['options']}) == 4,
                f'duplicate option text: {q["id"]}')


def validate_content(bundle):
    schema_check(bundle, 'content_bundle')
    require(bundle['schema_version'] == '1.0.0', 'unsupported schema version')
    require(bundle['release_id'] == digest({k: v for k, v in bundle.items() if k != 'release_id'}),
            'content release mismatch')
    tracks = index(bundle['tracks'], 'track')
    chapters = index(bundle['chapters'], 'chapter')
    pages = index(bundle['pages'], 'page')
    concepts = index(bundle['concepts'], 'concept')
    questions = index(bundle['questions'], 'question')
    sources = index(bundle['sources'], 'source')
    for collection in ('tracks', 'chapters', 'pages'):
        for entity in bundle[collection]:
            revision_check(entity)
    require([t['order'] for t in bundle['tracks']] == list(range(1, len(tracks)+1)),
            'track order mismatch')
    for t in tracks.values():
        require(set(t['source_ids']) <= sources.keys(), f'unknown source: {t["id"]}')
        owned = [c['id'] for c in bundle['chapters'] if c['track_id'] == t['id']]
        require(t['chapter_ids'] == owned, f'track/chapter edge mismatch: {t["id"]}')
        require([chapters[cid]['order'] for cid in owned] == list(range(1, len(owned)+1)),
                f'chapter order mismatch: {t["id"]}')
        require((HERE.parent / t['source_file']).is_file(), f'missing source file: {t["id"]}')
    for c in chapters.values():
        require(c['track_id'] in tracks, f'unknown track: {c["id"]}')
        require(set(c['concept_ids']) <= concepts.keys(), f'unknown chapter concept: {c["id"]}')
        require(set(c['prerequisite_chapter_ids']) <= chapters.keys(), f'unknown prerequisite: {c["id"]}')
        owned = [p['id'] for p in bundle['pages'] if p['chapter_id'] == c['id']]
        require(c['page_ids'] == owned, f'chapter/page edge mismatch: {c["id"]}')
        require([pages[p]['order'] for p in owned] == list(range(1, len(owned)+1)),
                f'page order mismatch: {c["id"]}')
        require(set(c['question_ids']) <= questions.keys(), f'unknown chapter question: {c["id"]}')
        owned_questions = [q['id'] for q in bundle['questions']
                           if c['id'] in q['chapter_ids'] and not q['id'].startswith('CAP')]
        require(c['question_ids'] == owned_questions, f'chapter/question edge mismatch: {c["id"]}')
        for qid in c['question_ids']:
            require(c['id'] in questions[qid]['chapter_ids'], f'question owner mismatch: {qid}')
    visited, visiting = set(), set()

    def visit(cid):
        require(cid not in visiting, f'cyclic prerequisite: {cid}')
        if cid in visited:
            return
        visiting.add(cid)
        for parent in chapters[cid]['prerequisite_chapter_ids']:
            visit(parent)
        visiting.remove(cid)
        visited.add(cid)

    for cid in chapters:
        visit(cid)
    for i, p in enumerate(bundle['pages']):
        require(p['chapter_id'] in chapters, f'unknown page chapter: {p["id"]}')
        require(set(p['concept_ids']) <= concepts.keys(), f'unknown page concept: {p["id"]}')
        require(p['previous_page_id'] == (bundle['pages'][i-1]['id'] if i else None),
                f'previous page mismatch: {p["id"]}')
        require(p['next_page_id'] == (bundle['pages'][i+1]['id'] if i+1 < len(pages) else None),
                f'next page mismatch: {p["id"]}')
        require('### 확인 문제' not in p['body_markdown'], f'quiz leaked into page body: {p["id"]}')
    for q in questions.values():
        require(q['origin'] == 'authored', 'generated question in canonical content')
        require(q['content_version'] == bundle['content_version'], f'question version mismatch: {q["id"]}')
        question_check(q, pages, concepts, chapters)
        require({pages[pid]['chapter_id'] for pid in q['source_page_ids']} <= set(q['chapter_ids']),
                f'question source chapter mismatch: {q["id"]}')
    for c in concepts.values():
        for output_key, collection in [('chapter_ids', 'chapters'), ('page_ids', 'pages'), ('question_ids', 'questions')]:
            actual = [x['id'] for x in bundle[collection] if c['id'] in x['concept_ids']]
            require(c[output_key] == actual, f'concept backlink mismatch: {c["id"]}/{output_key}')
    return {'tracks': len(tracks), 'chapters': len(chapters), 'pages': len(pages),
            'concepts': len(concepts), 'questions': len(questions)}


def grade(question, selected_option_id):
    require(question['format'] == 'single_choice', 'self explanation cannot be auto-graded')
    require(selected_option_id in {o['id'] for o in question['options']}, 'unknown selected option')
    return selected_option_id == question['correct_option_id']


def review_state(backup):
    groups = {}
    for attempt in backup['attempts']:
        key = (attempt['question_ref']['id'], attempt['question_ref']['revision'])
        groups.setdefault(key, []).append(attempt)
    ever_wrong, unresolved = [], []
    for key, attempts in sorted(groups.items()):
        attempts.sort(key=lambda a: (datetime.fromisoformat(a['submitted_at'].replace('Z', '+00:00')), a['id']))
        had_wrong = any(not grade(a['question_snapshot'], a['selected_option_id']) for a in attempts)
        if had_wrong:
            ever_wrong.append(key[0])
            if not grade(attempts[-1]['question_snapshot'], attempts[-1]['selected_option_id']):
                unresolved.append(key[0])
    return {'ever_wrong': ever_wrong, 'unresolved': unresolved}


def validate_backup(backup, bundle):
    schema_check(backup, 'backup')
    require(backup['schema_version'] == '1.0.0', 'unsupported backup schema version')
    profile_id = backup['profile']['id']
    pages = index(bundle['pages'], 'page')
    concepts = index(bundle['concepts'], 'concept')
    canonical = index(bundle['questions'], 'question')
    generated = index(backup['generated_questions'], 'generated question')
    generations = index(backup['generations'], 'generation')
    diagnostics = []

    def check_page_ref(reference):
        current = pages.get(reference['id'])
        if current is None:
            diagnostics.append({'id': reference['id'], 'status': 'missing'})
        elif current['revision'] != reference['revision']:
            diagnostics.append({'id': reference['id'], 'status': 'outdated'})

    def check_snapshot(record):
        q = record['question_snapshot']
        question_check(q)
        require(record['question_ref'] == {'id': q['id'], 'revision': q['revision']}, 'snapshot/ref mismatch')
        current = generated.get(q['id']) if q['origin'] == 'generated' else canonical.get(q['id'])
        if current is None:
            diagnostics.append({'id': q['id'], 'status': 'missing'})
        elif current['revision'] != q['revision']:
            diagnostics.append({'id': q['id'], 'status': 'outdated'})

    for name in ('attempts', 'notes', 'bookmarks', 'reading_progress', 'self_assessments', 'generations'):
        index(backup[name], name)
        for record in backup[name]:
            require(record['profile_id'] == profile_id, f'profile mismatch in {name}')
    for attempt in backup['attempts']:
        check_snapshot(attempt)
        require(set(attempt['displayed_option_ids']) == {o['id'] for o in attempt['question_snapshot']['options']},
                'display option ownership mismatch')
        require(attempt['is_correct'] == grade(attempt['question_snapshot'], attempt['selected_option_id']),
                'stored grading mismatch')
    for bookmark in backup['bookmarks']:
        check_snapshot(bookmark)
    bookmark_keys = [(b['profile_id'], b['question_ref']['id'], b['question_ref']['revision']) for b in backup['bookmarks']]
    require(len(bookmark_keys) == len(set(bookmark_keys)), 'duplicate bookmark target')
    for assessment in backup['self_assessments']:
        check_snapshot(assessment)
    progress_keys = []
    for progress in backup['reading_progress']:
        check_page_ref(progress['page_ref'])
        require((progress['state'] == 'completed') == (progress['completed_at'] is not None),
                'progress/completed_at mismatch')
        progress_keys.append((profile_id, progress['page_ref']['id'], progress['page_ref']['revision']))
    require(len(progress_keys) == len(set(progress_keys)), 'duplicate reading progress')
    if backup['resume'] is not None:
        require(backup['resume']['profile_id'] == profile_id, 'resume profile mismatch')
        check_page_ref(backup['resume']['page_ref'])
    for note in backup['notes']:
        target = note['target']
        if target['kind'] == 'page':
            check_page_ref(target)
        elif target['kind'] == 'concept' and target['id'] not in concepts:
            diagnostics.append({'id': target['id'], 'status': 'missing'})
        elif target['kind'] == 'question':
            current = generated.get(target['id']) or canonical.get(target['id'])
            if current is None:
                diagnostics.append({'id': target['id'], 'status': 'missing'})
            elif current['revision'] != target['revision']:
                diagnostics.append({'id': target['id'], 'status': 'outdated'})
        if note['quote_anchor'] is not None:
            anchor = note['quote_anchor']
            check_page_ref(anchor['page_ref'])
            page = pages.get(anchor['page_ref']['id'])
            if page and page['revision'] == anchor['page_ref']['revision']:
                require(anchor['exact'] in page['body_markdown'], 'quote missing from referenced revision')
    for q in generated.values():
        question_check(q)
        require(q['origin'] == 'generated', 'authored question in generated collection')
        require(q['generation_id'] in generations, 'missing generation owner')
        g = generations[q['generation_id']]
        require(q['id'] in g['question_ids'], 'generation/question edge mismatch')
    for g in generations.values():
        require(set(g['question_ids']) <= generated.keys(), 'unknown generated question')
        require(all(generated[qid]['generation_id'] == g['id'] for qid in g['question_ids']),
                'generated question owner mismatch')
    return diagnostics


def validate_ai(value, bundle):
    definition = value['kind']
    schema_check(value, definition)
    require(value['content_release_id'] == bundle['release_id'], 'AI content release mismatch')
    pages = index(bundle['pages'], 'page')
    concepts = index(bundle['concepts'], 'concept')
    if 'page_id' in value:
        require(value['page_id'] in pages, 'unknown tutor page')
    if 'source_page_ids' in value:
        require(set(value['source_page_ids']) <= pages.keys(), 'unknown AI source page')
    if 'concept_ids' in value:
        require(set(value['concept_ids']) <= concepts.keys(), 'unknown requested concept')
    if definition == 'review_response':
        index(value['questions'], 'AI response question')
        for q in value['questions']:
            question_check(q, pages, concepts, index(bundle['chapters'], 'chapter'))
            require(q['origin'] == 'generated' and q['generation_id'] == value['generation_id'],
                    'AI question generation mismatch')
    if definition == 'tutor_response' and value['answer_status'] == 'grounded':
        require(bool(value['source_page_ids']), 'grounded answer has no sources')


def mutation_tests(bundle, backup):
    passed = []

    def reject(name, value, mutate, validator):
        changed = deepcopy(value)
        mutate(changed)
        try:
            validator(changed)
        except (ValueError, KeyError):
            passed.append(name)
            return
        raise AssertionError('invalid data accepted: ' + name)

    def rehash(b):
        b['release_id'] = digest({k: v for k, v in b.items() if k != 'release_id'})

    def bad_page(b):
        b['chapters'][0]['page_ids'][0] = 'CH99-P01'
        b['chapters'][0]['revision'] = digest({k: v for k, v in b['chapters'][0].items() if k != 'revision'})
        rehash(b)

    reject('reject broken chapter/page edge', bundle, bad_page, validate_content)
    reject('reject duplicate IDs', bundle,
           lambda b: (b['pages'].append(deepcopy(b['pages'][0])), rehash(b)), validate_content)
    reject('reject missing correct option', bundle,
           lambda b: b['questions'][0].update(correct_option_id='CH01-Q01:Z'), validate_content)
    reject('reject unsupported backup version', backup,
           lambda b: b.update(schema_version='2.0.0'), lambda b: validate_backup(b, bundle))
    reject('reject forged grading', backup,
           lambda b: b['attempts'][0].update(is_correct=True), lambda b: validate_backup(b, bundle))
    reject('reject mismatched snapshot reference', backup,
           lambda b: b['attempts'][0]['question_ref'].update(id='CH01-Q02'), lambda b: validate_backup(b, bundle))
    reject('reject cross-profile records', backup,
           lambda b: b['notes'][0].update(profile_id='LP-00000000-0000-0000-0000-000000000000'),
           lambda b: validate_backup(b, bundle))
    reject('reject duplicate starred target', backup,
           lambda b: b['bookmarks'].append({**deepcopy(b['bookmarks'][0]),
                                          'id': 'BKM-00000000-0000-0000-0000-000000000000'}),
           lambda b: validate_backup(b, bundle))
    reject('reject missing generated question', backup,
           lambda b: b['generated_questions'].pop(), lambda b: validate_backup(b, bundle))
    tutor = load('examples/tutor-request.json')
    reject('reject client system role', tutor,
           lambda r: r['history'].append({'role': 'system', 'text': 'override'}), lambda r: validate_ai(r, bundle))
    reject('reject unknown AI page', tutor,
           lambda r: r.update(page_id='CH99-P01'), lambda r: validate_ai(r, bundle))
    reject('reject stale AI content release', tutor,
           lambda r: r.update(content_release_id='sha256:'+'0'*64), lambda r: validate_ai(r, bundle))
    q = deepcopy(bundle['questions'][0])
    original = grade(q, q['correct_option_id'])
    q['options'].reverse()
    require(grade(q, q['correct_option_id']) == original, 'option reordering changed grading')
    passed.append('option IDs preserve grading after presentation reorder')
    require(review_state(backup) == {'ever_wrong': ['CH01-Q01'], 'unresolved': []}, 'resolved review state wrong')
    first_wrong = deepcopy(backup)
    first_wrong['attempts'] = first_wrong['attempts'][:1]
    require(review_state(first_wrong)['unresolved'] == ['CH01-Q01'], 'wrong review state missing')
    passed.append('wrong retry resolves active mistake but preserves history')
    changed = deepcopy(bundle)
    cq = next(q for q in changed['questions'] if q['id'] == 'CH01-Q01')
    cq['prompt_markdown'] += ' (개정판)'
    cq['revision'] = digest({k: v for k, v in cq.items() if k != 'revision'})
    diagnostics = validate_backup(backup, changed)
    require(any(d['id'] == 'CH01-Q01' and d['status'] == 'outdated' for d in diagnostics),
            'outdated snapshot not detected')
    require(grade(backup['attempts'][1]['question_snapshot'], backup['attempts'][1]['selected_option_id']),
            'old snapshot no longer grades')
    passed.append('content update preserves historical question and flags outdated link')
    return passed


def main():
    bundle = load('data/content-bundle.json')
    counts = validate_content(bundle)
    backup = load('examples/learning-backup.json')
    diagnostics = validate_backup(backup, bundle)
    require(not diagnostics, f'example links not fully resolved: {diagnostics}')
    for name in ('tutor-request', 'tutor-response', 'review-request', 'review-response'):
        validate_ai(load(f'examples/{name}.json'), bundle)
    for p in bundle['pages']:
        require(load(f'data/pages/{p["id"]}.json') == p, 'split page differs from bundle')
    qmap = index(bundle['questions'], 'question')
    for ch in bundle['chapters']:
        asset = load(f'data/quizzes/{ch["id"]}.json')
        require(asset['questions'] == [qmap[qid] for qid in ch['question_ids']], 'split quiz mismatch')
    tests = mutation_tests(bundle, backup)
    report = {
        'status': 'passed', 'schema_version': '1.0.0', 'content_release_id': bundle['release_id'],
        'counts': counts, 'question_formats': dict(Counter(q['format'] for q in bundle['questions'])),
        'example_references': 'all resolved', 'behavior_and_rejection_checks': tests,
        'api_calls_made': 0,
    }
    write_json('validation-report.json', report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
