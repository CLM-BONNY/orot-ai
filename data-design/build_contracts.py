"""Write JSON Schema contracts and explicitly fictional local-record examples."""
from copy import deepcopy
import json
from pathlib import Path
import uuid

from build_content import digest, finish, write_json

HERE = Path(__file__).resolve().parent
S = {'type': 'string', 'minLength': 1}
VERSION = {'type': 'string', 'pattern': r'^\d+\.\d+\.\d+$'}
REV = {'type': 'string', 'pattern': r'^sha256:[0-9a-f]{64}$'}
TIME = {'type': 'string', 'format': 'date-time'}
UUID = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
TID = {'type': 'string', 'pattern': r'^T\d{2}$'}
CID = {'type': 'string', 'pattern': r'^CH\d{2}$'}
PID = {'type': 'string', 'pattern': r'^CH\d{2}-P\d{2}$'}
CONCEPT = {'type': 'string', 'pattern': r'^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$'}
QID = {'type': 'string', 'pattern': rf'^(CH\d{{2}}-[QR]\d{{2}}|CAP\d{{2}}|GQ-{UUID})$'}
OID = {'type': 'string', 'pattern': rf'^(CH\d{{2}}-Q\d{{2}}|GQ-{UUID}):[A-D]$'}


def enum(*values):
    return {'enum': list(values)}


def const(value):
    return {'const': value}


def nullable(schema):
    return {'anyOf': [schema, {'type': 'null'}]}


def arr(item, minimum=0, maximum=None, unique=False):
    value = {'type': 'array', 'items': item, 'minItems': minimum}
    if maximum is not None:
        value['maxItems'] = maximum
    if unique:
        value['uniqueItems'] = True
    return value


def ids(item, minimum=0, maximum=None):
    return arr(item, minimum, maximum, unique=True)


def obj(properties, optional=()):
    return {'type': 'object', 'properties': properties,
            'required': [k for k in properties if k not in optional],
            'additionalProperties': False}


def ref(name):
    return {'$ref': f'#/$defs/{name}'}


def local_id(prefix):
    return {'type': 'string', 'pattern': rf'^{prefix}-{UUID}$'}


def schema_definitions():
    d = {}
    d['source'] = obj({'id': {'type': 'string', 'pattern': '^SRC-[0-9a-f]{12}$'},
                       'title': S, 'url': {'type': 'string', 'format': 'uri'}})
    d['track'] = obj({'id': TID, 'title': S, 'order': {'type': 'integer', 'minimum': 1},
                      'introduction_markdown': S, 'chapter_ids': ids(CID, 1),
                      'source_ids': ids(S), 'source_file': S, 'revision': REV})
    d['chapter'] = obj({'id': CID, 'track_id': TID, 'title': S,
                        'order': {'type': 'integer', 'minimum': 1},
                        'prerequisite_chapter_ids': ids(CID), 'learning_objectives': ids(S, 1),
                        'concept_ids': ids(CONCEPT, 1), 'page_ids': ids(PID, 1),
                        'question_ids': ids(QID, 1), 'revision': REV})
    d['page'] = obj({'id': PID, 'chapter_id': CID, 'title': S,
                     'order': {'type': 'integer', 'minimum': 1},
                     'concept_ids': ids(CONCEPT, 1), 'body_markdown': S,
                     'previous_page_id': nullable(PID), 'next_page_id': nullable(PID),
                     'revision': REV})
    d['concept'] = obj({'id': CONCEPT, 'chapter_ids': ids(CID, 1),
                        'page_ids': ids(PID, 1), 'question_ids': ids(QID)})
    d['option'] = obj({'id': OID, 'text': S})
    qcommon = {'id': QID, 'format': const('single_choice'),
               'origin': enum('authored', 'generated'), 'content_version': VERSION,
               'chapter_ids': ids(CID, 1), 'concept_ids': ids(CONCEPT, 1),
               'source_page_ids': ids(PID, 1), 'prompt_markdown': S,
               'category': S, 'difficulty': enum('not_rated', 'beginner', 'intermediate', 'advanced'),
               'options': arr(ref('option'), 4, 4), 'correct_option_id': OID,
               'explanation_markdown': S, 'generation_id': nullable(local_id('GEN')),
               'revision': REV}
    d['single_choice'] = obj(qcommon)
    d['single_choice']['allOf'] = [
        {'if': {'properties': {'origin': const('authored')}},
         'then': {'properties': {'id': {'pattern': r'^CH\d{2}-Q\d{2}$'}, 'generation_id': {'type': 'null'}}},
         'else': {'properties': {'id': {'pattern': rf'^GQ-{UUID}$'}, 'generation_id': local_id('GEN')}}}
    ]
    d['reflection'] = obj({
        'id': {'type': 'string', 'pattern': r'^(CH\d{2}-R\d{2}|CAP\d{2})$'},
        'format': const('self_explanation'), 'origin': const('authored'),
        'content_version': VERSION, 'chapter_ids': ids(CID, 1), 'concept_ids': ids(CONCEPT, 1),
        'source_page_ids': ids(PID, 1), 'prompt_markdown': S, 'category': S,
        'difficulty': enum('not_rated', 'beginner', 'intermediate', 'advanced'),
        'expected_answer_markdown': S, 'grading': const('self_assessment'), 'revision': REV,
    })
    d['question'] = {'oneOf': [ref('single_choice'), ref('reflection')]}
    d['content_bundle'] = obj({
        'kind': const('content_bundle'), 'schema_version': VERSION, 'content_version': VERSION,
        'dataset_id': S, 'release_id': REV, 'tracks': arr(ref('track'), 1),
        'chapters': arr(ref('chapter'), 1), 'pages': arr(ref('page'), 1),
        'concepts': arr(ref('concept'), 1), 'questions': arr(ref('question'), 1),
        'sources': arr(ref('source')),
    })
    d['page_ref'] = obj({'id': PID, 'revision': REV})
    d['question_ref'] = obj({'id': QID, 'revision': REV})
    d['note_target'] = {'oneOf': [
        obj({'kind': const('page'), 'id': PID, 'revision': REV}),
        obj({'kind': const('concept'), 'id': CONCEPT}),
        obj({'kind': const('question'), 'id': QID, 'revision': REV}),
    ]}
    d['quote_anchor'] = obj({'exact': S, 'prefix': {'type': 'string'},
                             'suffix': {'type': 'string'}, 'page_ref': ref('page_ref')})
    d['profile'] = obj({'id': local_id('LP'), 'display_name': S,
                        'created_at': TIME, 'updated_at': TIME})
    d['attempt'] = obj({
        'id': local_id('ATT'), 'profile_id': local_id('LP'),
        'question_ref': ref('question_ref'), 'question_snapshot': ref('single_choice'),
        'displayed_option_ids': ids(OID, 4, 4),
        'selected_option_id': OID, 'is_correct': {'type': 'boolean'},
        'submitted_at': TIME, 'elapsed_ms': {'type': 'integer', 'minimum': 0},
        'mode': enum('chapter_quiz', 'wrong_retry', 'starred', 'ai_review'),
    })
    d['note'] = obj({'id': local_id('NOTE'), 'profile_id': local_id('LP'),
                     'target': ref('note_target'), 'quote_anchor': nullable(ref('quote_anchor')),
                     'body_markdown': S, 'created_at': TIME, 'updated_at': TIME})
    d['bookmark'] = obj({'id': local_id('BKM'), 'profile_id': local_id('LP'),
                         'question_ref': ref('question_ref'), 'question_snapshot': ref('question'),
                         'created_at': TIME})
    d['reading_progress'] = obj({
        'id': local_id('READ'), 'profile_id': local_id('LP'), 'page_ref': ref('page_ref'),
        'state': enum('started', 'completed'), 'completed_at': nullable(TIME), 'updated_at': TIME,
    })
    d['resume'] = obj({'profile_id': local_id('LP'), 'page_ref': ref('page_ref'),
                       'scroll_fraction': {'type': 'number', 'minimum': 0, 'maximum': 1},
                       'updated_at': TIME})
    d['self_assessment'] = obj({
        'id': local_id('SELF'), 'profile_id': local_id('LP'),
        'question_ref': ref('question_ref'), 'question_snapshot': ref('reflection'),
        'response_markdown': S, 'rating': enum('again', 'partial', 'understood'),
        'submitted_at': TIME,
    })
    d['generation'] = obj({
        'id': local_id('GEN'), 'profile_id': local_id('LP'),
        'request_id': local_id('REQ'), 'content_release_id': REV,
        'concept_ids': ids(CONCEPT, 1, 5), 'question_ids': ids(QID, 3, 3),
        'model': S, 'prompt_version': S, 'review_status': const('unreviewed'),
        'created_at': TIME,
    })
    d['backup'] = obj({
        'kind': const('learning_backup'), 'schema_version': VERSION,
        'content_release_id': REV, 'exported_at': TIME,
        'profile': ref('profile'), 'attempts': arr(ref('attempt')),
        'notes': arr(ref('note')), 'bookmarks': arr(ref('bookmark')),
        'reading_progress': arr(ref('reading_progress')), 'resume': nullable(ref('resume')),
        'self_assessments': arr(ref('self_assessment')), 'generations': arr(ref('generation')),
        'generated_questions': arr(ref('single_choice')),
    })
    d['history_message'] = obj({'role': enum('user', 'assistant'),
                                'text': {'type': 'string', 'minLength': 1, 'maxLength': 2000}})
    d['tutor_request'] = obj({
        'kind': const('tutor_request'), 'request_id': local_id('REQ'),
        'content_release_id': REV, 'page_id': PID,
        'message': {'type': 'string', 'minLength': 1, 'maxLength': 3000},
        'selected_text': nullable({'type': 'string', 'minLength': 1, 'maxLength': 2000}),
        'history': arr(ref('history_message'), 0, 8),
    })
    d['tutor_response'] = obj({
        'kind': const('tutor_response'), 'request_id': local_id('REQ'),
        'content_release_id': REV, 'answer_markdown': S,
        'answer_status': enum('grounded', 'insufficient_context'),
        'source_page_ids': ids(PID), 'model': S, 'prompt_version': S,
    })
    d['review_request'] = obj({
        'kind': const('review_request'), 'request_id': local_id('REQ'),
        'content_release_id': REV, 'concept_ids': ids(CONCEPT, 1, 5),
        'question_count': const(3), 'difficulty': enum('beginner', 'intermediate', 'advanced'),
        'source_page_ids': ids(PID, 0, 10),
    })
    d['review_response'] = obj({
        'kind': const('review_response'), 'request_id': local_id('REQ'),
        'content_release_id': REV, 'generation_id': local_id('GEN'),
        'model': S, 'prompt_version': S, 'review_status': const('unreviewed'),
        'questions': arr(ref('single_choice'), 3, 3),
    })
    return d


def make_schema():
    root = {
        '$schema': 'https://json-schema.org/draft/2020-12/schema',
        'title': 'AI Engineer learning content and local record contracts',
        'description': 'Version 1.0.0; foreign keys and revision integrity require validate_data.py.',
        '$defs': schema_definitions(),
        'oneOf': [ref(n) for n in ('content_bundle', 'backup', 'tutor_request',
                                  'tutor_response', 'review_request', 'review_response')],
    }
    write_json('schema/data-contract.schema.json', root)
    return root


def eid(prefix, label):
    return f'{prefix}-{uuid.uuid5(uuid.NAMESPACE_URL, "ai-learning-example/"+label)}'


def make_examples(bundle):
    # Times are illustrative fixtures, not records of an actual learner or API run.
    t0 = '2026-10-18T01:00:00Z'
    t1 = '2026-10-18T01:02:00Z'
    t2 = '2026-10-18T01:05:00Z'
    profile = eid('LP', 'profile')
    q = deepcopy(next(q for q in bundle['questions'] if q['id'] == 'CH01-Q01'))
    p = next(p for p in bundle['pages'] if p['id'] == 'CH01-P01')
    reflection = deepcopy(next(q for q in bundle['questions'] if q['id'] == 'CH01-R01'))
    pref = {'id': p['id'], 'revision': p['revision']}
    qref = {'id': q['id'], 'revision': q['revision']}
    backup = {
        'kind': 'learning_backup', 'schema_version': '1.0.0',
        'content_release_id': bundle['release_id'], 'exported_at': t2,
        'profile': {'id': profile, 'display_name': '예시 학습자', 'created_at': t0, 'updated_at': t2},
        'attempts': [], 'notes': [], 'bookmarks': [], 'reading_progress': [],
        'resume': None, 'self_assessments': [], 'generations': [], 'generated_questions': [],
    }
    for label, chosen, timestamp, mode in [('wrong', 'A', t1, 'chapter_quiz'),
                                            ('retry', 'B', t2, 'wrong_retry')]:
        backup['attempts'].append({
            'id': eid('ATT', label), 'profile_id': profile, 'question_ref': qref,
            'question_snapshot': q, 'selected_option_id': q['id']+':'+chosen,
            'displayed_option_ids': [option['id'] for option in q['options']],
            'is_correct': q['correct_option_id'] == q['id']+':'+chosen,
            'submitted_at': timestamp, 'elapsed_ms': 15000, 'mode': mode,
        })
    backup['notes'].append({
        'id': eid('NOTE', 'note'), 'profile_id': profile,
        'target': {'kind': 'page', **pref},
        'quote_anchor': {'page_ref': pref, 'exact': 'RAG는 모델 종류가 아니라',
                         'prefix': '', 'suffix': ' 외부 자료를 검색해'},
        'body_markdown': 'RAG는 모델 이름이 아니라 검색과 생성을 연결하는 방식이다.',
        'created_at': t1, 'updated_at': t2,
    })
    backup['bookmarks'].append({'id': eid('BKM', 'bookmark'), 'profile_id': profile,
                                 'question_ref': qref, 'question_snapshot': q, 'created_at': t1})
    backup['reading_progress'].append({
        'id': eid('READ', 'read'), 'profile_id': profile, 'page_ref': pref,
        'state': 'completed', 'completed_at': t1, 'updated_at': t1,
    })
    backup['resume'] = {'profile_id': profile, 'page_ref': pref, 'scroll_fraction': 0.8, 'updated_at': t2}
    backup['self_assessments'].append({
        'id': eid('SELF', 'self'), 'profile_id': profile,
        'question_ref': {'id': reflection['id'], 'revision': reflection['revision']},
        'question_snapshot': reflection,
        'response_markdown': 'NLP는 문제 영역이고 LLM은 모델, RAG는 시스템 구성이다.',
        'rating': 'partial', 'submitted_at': t2,
    })
    generation_id = eid('GEN', 'generation')
    request_id = eid('REQ', 'review')
    for i in range(3):
        # Human-authored synthetic fixture, not a real AI-generated output.
        generated = deepcopy(q)
        generated.pop('revision')
        gid = eid('GQ', f'generated-{i}')
        generated.update({'id': gid, 'origin': 'generated', 'generation_id': generation_id,
                          'difficulty': 'beginner', 'concept_ids': ['rag'],
                          'prompt_markdown': f'예시 복습 문제 {i+1}: RAG의 설명으로 맞는 것은?',
                          'category': '예시 데이터'})
        for o in generated['options']:
            o['id'] = gid + ':' + o['id'].split(':')[-1]
        generated['correct_option_id'] = gid + ':B'
        backup['generated_questions'].append(finish(generated))
    backup['generations'].append({
        'id': generation_id, 'profile_id': profile, 'request_id': request_id,
        'content_release_id': bundle['release_id'], 'concept_ids': ['rag'],
        'question_ids': [q['id'] for q in backup['generated_questions']],
        'model': 'example-only-no-api-call', 'prompt_version': 'example-1',
        'review_status': 'unreviewed', 'created_at': t2,
    })
    write_json('examples/learning-backup.json', backup)
    tutor_req = {
        'kind': 'tutor_request', 'request_id': eid('REQ', 'tutor'),
        'content_release_id': bundle['release_id'], 'page_id': p['id'],
        'message': 'RAG와 모델 자체의 지식은 어떻게 다른가요?',
        'selected_text': 'RAG는 모델 종류가 아니라', 'history': [],
    }
    tutor_res = {
        'kind': 'tutor_response', 'request_id': tutor_req['request_id'],
        'content_release_id': bundle['release_id'], 'answer_markdown':
        '모델의 학습된 패턴과 요청 시 검색해 제공하는 자료는 서로 다른 지식 공급 경로입니다.',
        'answer_status': 'grounded', 'source_page_ids': [p['id']],
        'model': 'example-only-no-api-call', 'prompt_version': 'example-1',
    }
    review_req = {
        'kind': 'review_request', 'request_id': request_id,
        'content_release_id': bundle['release_id'], 'concept_ids': ['rag'],
        'question_count': 3, 'difficulty': 'beginner', 'source_page_ids': ['CH01-P01'],
    }
    review_res = {
        'kind': 'review_response', 'request_id': request_id,
        'content_release_id': bundle['release_id'], 'generation_id': generation_id,
        'model': 'example-only-no-api-call', 'prompt_version': 'example-1',
        'review_status': 'unreviewed', 'questions': backup['generated_questions'],
    }
    for name, example in [('tutor-request', tutor_req), ('tutor-response', tutor_res),
                           ('review-request', review_req), ('review-response', review_res)]:
        write_json(f'examples/{name}.json', example)
    return backup


if __name__ == '__main__':
    make_schema()
    make_examples(json.loads((HERE / 'data/content-bundle.json').read_text()))
    print('Schema and illustrative examples written; no API calls made.')
