"""Check a running production build without invoking AI or changing browser records."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import urlopen


def verify(base):
    checks = []
    def get(path):
        try:
            with urlopen(base + path, timeout=10) as r:
                return r.status, r.headers, r.read()
        except HTTPError as e:
            return e.code, e.headers, e.read()
    status, _, raw = get('/content/curriculum.json')
    assert status == 200
    content = json.loads(raw)
    status, _, raw = get('/api/meta')
    assert status == 200 and json.loads(raw)['content_release_id'] == content['release_id']
    checks.append('frontend/API content release matches')
    for page in content['pages']:
        status, _, raw = get('/content/pages/' + page['id'] + '.json')
        loaded = json.loads(raw)
        assert status == 200 and loaded['id'] == page['id'] and loaded['revision'] == page['revision'] and loaded['body_markdown'].strip()
    checks.append(f'{len(content["pages"])} page bodies and revisions')
    question_count = 0
    for chapter in content['chapters']:
        status, _, raw = get('/content/quizzes/' + chapter['id'] + '.json')
        assert status == 200
        question_count += len(json.loads(raw)['questions'])
    status, _, raw = get('/content/capstones.json')
    assert status == 200
    question_count += len(json.loads(raw))
    checks.append(f'32 chapter quiz files + capstones: {question_count} questions')
    for path in ['/', '/learn/CH01-P01','/learn/CH21-P01','/curriculum','/notebook?tab=notes','/quiz/CH01','/quiz/capstones','/review/wrong','/review/star','/review/ai?generation=test','/ai-review']:
        status, headers, raw = get(path)
        assert status == 200 and 'text/html' in headers['Content-Type'] and b'/assets/' in raw and headers['Cache-Control'] == 'no-cache'
    checks.append('11 direct SPA routes with no-cache HTML')
    for path in ['/api/missing','/content/missing.json','/assets/missing.js','/.env.local','/backend/config.py']:
        status, _, raw = get(path)
        assert status == 404 and b'<!doctype html>' not in raw.lower()
    checks.append('missing API/content/assets/private paths return 404')
    return {'checked_at':datetime.now(timezone.utc).isoformat(), 'base_url':base,'passed':True,
            'content_release_id':content['release_id'],'checks':checks,
            'limits':['HTTP checks only; no UI, inference, load or performance benchmark in this script']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:5178')
    parser.add_argument('--output', type=Path, default=Path(__file__).parent/'production-http-result.json')
    args = parser.parse_args()
    result = verify(args.url.rstrip('/'))
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(result,ensure_ascii=False,indent=2))
