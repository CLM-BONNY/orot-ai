"""Run inside the deployed API container; uses real inference, never fixture responses."""
import json
import sys
import time
import uuid
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def call(path, payload=None):
    start = time.monotonic()
    req = Request('http://127.0.0.1:8000' + path,
                  data=json.dumps(payload).encode() if payload is not None else None,
                  headers={'Content-Type': 'application/json'})
    try:
        with urlopen(req, timeout=195) as response:
            return response.status, json.load(response), dict(response.headers), round(time.monotonic()-start, 3)
    except HTTPError as error:
        return error.code, json.load(error), dict(error.headers), round(time.monotonic()-start, 3)


mode = sys.argv[1] if len(sys.argv) > 1 else 'online'
status, meta, _, _ = call('/api/meta')
assert status == 200 and meta['provider'] == 'openai_compatible', meta
tutor = {'kind': 'tutor_request', 'request_id': 'REQ-' + str(uuid.uuid4()),
         'content_release_id': meta['content_release_id'], 'page_id': 'CH01-P01',
         'message': 'RAG와 모델 자체의 지식은 어떻게 다른가요? 쉬운 예시로 설명해 주세요.', 'history': []}
result = {'mode': mode, 'meta': meta, 'health_status': call('/api/health')[0],
          'content_status': call('/content/curriculum.json')[0]}
if mode == 'offline':
    assert meta['model_ready'] is False, meta
    status, body, _, seconds = call('/api/ai/tutor', tutor)
    assert status == 503 and body['error']['code'] == 'MODEL_UNAVAILABLE', body
    result.update(tutor_status=status, tutor_error=body, seconds=seconds)
else:
    assert meta['model_ready'] is True, meta
    status, body, _, seconds = call('/api/ai/tutor', tutor)
    result.update(tutor_status=status, tutor=body, tutor_seconds=seconds,
                  tutor_metrics=call('/api/last-metrics')[1])
    if status != 200:
        print(json.dumps(result, ensure_ascii=False)); raise RuntimeError('Real tutor failed')
    assert body['answer_markdown'].strip() and body['source_page_ids'], body
    if mode == 'online':
        review = {'kind': 'review_request', 'request_id': 'REQ-' + str(uuid.uuid4()),
                  'content_release_id': meta['content_release_id'], 'concept_ids': ['rag'],
                  'source_page_ids': ['CH01-P01'], 'question_count': 3, 'difficulty': 'beginner'}
        status, body, _, seconds = call('/api/ai/review-quiz', review)
        result.update(review_status=status, review=body, review_seconds=seconds,
                      review_metrics=call('/api/last-metrics')[1])
        if status != 200:
            print(json.dumps(result, ensure_ascii=False)); raise RuntimeError('Real review generation failed')
        assert len(body['questions']) == 3, body
        for question in body['questions']:
            assert len(question['options']) == 4
            assert question['correct_option_id'] in [x['id'] for x in question['options']]
            assert question['explanation_markdown'].strip()
        reused_status, reused, headers, _ = call('/api/ai/review-quiz', review)
        assert reused_status == 200 and reused == body
        assert headers.get('X-Generation-Reused', headers.get('x-generation-reused')) == 'true'
        result['review_idempotency_verified'] = True
assert result['health_status'] == result['content_status'] == 200, result
print(json.dumps(result, ensure_ascii=False))
