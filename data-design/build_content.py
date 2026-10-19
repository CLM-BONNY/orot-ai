"""Export the authored Markdown as an ID-linked content bundle (no API calls)."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent / 'learning-content'
VERSION = '1.0.0'


def digest(value):
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return 'sha256:' + hashlib.sha256(payload.encode()).hexdigest()


def write_json(name, value):
    path = HERE / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def clean(text):
    return re.sub(r'^<a id="[^"]+"></a>\n?', '', text, flags=re.M).strip()


def finish(entity):
    entity['revision'] = digest(entity)
    return entity


def parse_content():
    mapping = json.loads((HERE / 'concept-map.json').read_text())
    answer_text = (SOURCE / '09-retrieval-practice-answers.md').read_text()
    recall_answers = {
        m[1]: clean(m[2]) for m in re.finditer(
            r'^## (CH\d{2}-R\d{2}) 해설\n(.*?)(?=^## |\Z)', answer_text, re.M | re.S
        )
    }
    bundle = {
        'kind': 'content_bundle', 'schema_version': VERSION,
        'content_version': VERSION, 'dataset_id': 'ai-engineer-foundations',
        'tracks': [], 'chapters': [], 'pages': [], 'concepts': [],
        'questions': [], 'sources': [],
    }
    source_ids = {}
    for order, path in enumerate(sorted(SOURCE.glob('0[1-8]-*.md')), 1):
        text = path.read_text()
        head = re.search(r'^# (T\d{2})\. (.+)$', text, re.M)
        tid = head[1]
        matches = list(re.finditer(r'^## (CH\d{2})\. (.+)$', text, re.M))
        intro = clean(text[head.end():matches[0].start()])
        refs = text.split('## 참고 자료', 1)[1]
        track_source_ids = []
        for title, url in re.findall(r'\[([^\]]+)\]\((https://[^\s)]+)\)', refs):
            if url not in source_ids:
                sid = 'SRC-' + hashlib.sha256(url.encode()).hexdigest()[:12]
                source_ids[url] = sid
                bundle['sources'].append({'id': sid, 'title': title, 'url': url})
            track_source_ids.append(source_ids[url])
        track = {
            'id': tid, 'title': head[2], 'order': order,
            'introduction_markdown': intro, 'chapter_ids': [],
            'source_ids': track_source_ids,
            'source_file': f'learning-content/{path.name}',
        }
        for index, match in enumerate(matches, 1):
            end = matches[index].start() if index < len(matches) else text.index('## 참고 자료')
            block = text[match.end():end]
            cid = match[1]
            chapter_concepts = re.findall(
                r'`([^`]+)`', re.search(r'^- 개념 ID: (.+)$', block, re.M)[1]
            )
            chapter = {
                'id': cid, 'track_id': tid, 'title': match[2], 'order': index,
                'prerequisite_chapter_ids': re.findall(
                    r'CH\d{2}', re.search(r'^- 선수 학습: (.+)$', block, re.M)[1]),
                'learning_objectives': [re.search(r'^- 학습 목표: (.+)$', block, re.M)[1]],
                'concept_ids': chapter_concepts, 'page_ids': [], 'question_ids': [],
            }
            page_matches = list(re.finditer(r'^### (CH\d{2}-P\d{2})\. (.+)$', block, re.M))
            for pindex, pm in enumerate(page_matches, 1):
                pend = page_matches[pindex].start() if pindex < len(page_matches) else block.index('### 확인 문제')
                page = {
                    'id': pm[1], 'chapter_id': cid, 'title': pm[2], 'order': pindex,
                    'concept_ids': mapping[cid]['pages'][pindex-1],
                    'body_markdown': clean(block[pm.end():pend]),
                    'previous_page_id': None, 'next_page_id': None,
                }
                bundle['pages'].append(page)
                chapter['page_ids'].append(pm[1])
            qmatches = list(re.finditer(r'^#### (CH\d{2}-Q\d{2}) · (.+)$', block, re.M))
            for qindex, qm in enumerate(qmatches, 1):
                qend = qmatches[qindex].start() if qindex < len(qmatches) else block.index('**인출 연습')
                qb = clean(block[qm.end():qend])
                am = re.search(r'\*\*정답: ([ABCD])\.\*\* (.*)', qb, re.S)
                if am is None:
                    raise ValueError(f'Missing answer: {qm[1]}')
                explanation = am[2].split('관련 페이지:', 1)[0].strip()
                source_pages = re.findall(r'CH\d{2}-P\d{2}', am[2].split('관련 페이지:', 1)[1])
                options = re.findall(r'^([ABCD])\. (.+)$', qb, re.M)
                question = {
                    'id': qm[1], 'format': 'single_choice', 'origin': 'authored',
                    'content_version': VERSION, 'chapter_ids': [cid],
                    'concept_ids': mapping[cid]['questions'][qindex-1],
                    'source_page_ids': source_pages,
                    'prompt_markdown': qb[:re.search(r'^A\. ', qb, re.M).start()].strip(),
                    'category': qm[2], 'difficulty': 'not_rated',
                    'options': [{'id': f'{qm[1]}:{letter}', 'text': label} for letter, label in options],
                    'correct_option_id': f'{qm[1]}:{am[1]}',
                    'explanation_markdown': explanation,
                    'generation_id': None,
                }
                bundle['questions'].append(finish(question))
                chapter['question_ids'].append(qm[1])
            rm = re.search(r'\*\*인출 연습 (CH\d{2}-R\d{2}):\*\* (.+)', block)
            reflection = {
                'id': rm[1], 'format': 'self_explanation', 'origin': 'authored',
                'content_version': VERSION, 'chapter_ids': [cid],
                'concept_ids': chapter_concepts, 'source_page_ids': chapter['page_ids'][:],
                'prompt_markdown': rm[2], 'category': '인출 연습', 'difficulty': 'not_rated',
                'expected_answer_markdown': recall_answers[rm[1]],
                'grading': 'self_assessment',
            }
            bundle['questions'].append(finish(reflection))
            chapter['question_ids'].append(rm[1])
            track['chapter_ids'].append(cid)
            bundle['chapters'].append(finish(chapter))
        bundle['tracks'].append(finish(track))

    capstone_pages = {
        'CAP01': ['CH13-P03', 'CH22-P01', 'CH22-P02', 'CH25-P02', 'CH27-P03', 'CH30-P01'],
        'CAP02': ['CH22-P03', 'CH24-P02', 'CH30-P03', 'CH32-P02'],
        'CAP03': ['CH31-P01', 'CH31-P02', 'CH31-P03'],
        'CAP04': ['CH24-P03', 'CH28-P03', 'CH30-P03'],
        'CAP05': ['CH04-P03', 'CH05-P02', 'CH05-P03', 'CH08-P03', 'CH11-P01'],
        'CAP06': ['CH21-P03', 'CH24-P03', 'CH25-P02', 'CH27-P03', 'CH29-P01', 'CH30-P01'],
    }
    page_lookup = {p['id']: p for p in bundle['pages']}
    for m in re.finditer(r'^### (CAP\d{2})\. ([^\n]+)\n(.*?)(?=^### |\Z)', answer_text, re.M | re.S):
        prompt, answer = m[3].split('**해설:**', 1)
        pids = capstone_pages[m[1]]
        question = {
            'id': m[1], 'format': 'self_explanation', 'origin': 'authored',
            'content_version': VERSION,
            'chapter_ids': list(dict.fromkeys(pid[:4] for pid in pids)),
            'concept_ids': sorted({c for pid in pids for c in page_lookup[pid]['concept_ids']}),
            'source_page_ids': pids, 'prompt_markdown': clean(prompt),
            'category': m[2], 'difficulty': 'not_rated',
            'expected_answer_markdown': clean(answer), 'grading': 'self_assessment',
        }
        bundle['questions'].append(finish(question))

    for i, page in enumerate(bundle['pages']):
        page['previous_page_id'] = bundle['pages'][i-1]['id'] if i else None
        page['next_page_id'] = bundle['pages'][i+1]['id'] if i+1 < len(bundle['pages']) else None
        finish(page)
    concept_ids = sorted({c for ch in bundle['chapters'] for c in ch['concept_ids']})
    for cid in concept_ids:
        bundle['concepts'].append({
            'id': cid,
            'chapter_ids': [ch['id'] for ch in bundle['chapters'] if cid in ch['concept_ids']],
            'page_ids': [p['id'] for p in bundle['pages'] if cid in p['concept_ids']],
            'question_ids': [q['id'] for q in bundle['questions'] if cid in q['concept_ids']],
        })
    bundle['release_id'] = digest(bundle)
    return bundle


def main():
    bundle = parse_content()
    write_json('data/content-bundle.json', bundle)
    # These derived assets enable later page/chapter-level loading.
    for page in bundle['pages']:
        write_json(f"data/pages/{page['id']}.json", page)
    for chapter in bundle['chapters']:
        qids = set(chapter['question_ids'])
        write_json(f"data/quizzes/{chapter['id']}.json", {
            'content_version': VERSION, 'chapter_id': chapter['id'],
            'questions': [q for q in bundle['questions'] if q['id'] in qids],
        })
    write_json('data/curriculum.json', {
        'schema_version': VERSION, 'content_version': VERSION, 'release_id': bundle['release_id'],
        'tracks': bundle['tracks'], 'chapters': bundle['chapters'],
        'pages': [{k: v for k, v in p.items() if k != 'body_markdown'} for p in bundle['pages']],
        'concepts': bundle['concepts'], 'sources': bundle['sources'],
        'capstone_question_ids': [q['id'] for q in bundle['questions'] if q['id'].startswith('CAP')],
    })
    write_json('data/capstones.json', [q for q in bundle['questions'] if q['id'].startswith('CAP')])
    return bundle


if __name__ == '__main__':
    value = main()
    print({key: len(value[key]) for key in ('tracks', 'chapters', 'pages', 'concepts', 'questions')})
