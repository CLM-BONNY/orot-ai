import asyncio
from copy import deepcopy
from dataclasses import replace
import json
from pathlib import Path

from fastapi.testclient import TestClient
import httpx
import pytest

from backend.app import create_app
from backend.config import settings
from backend.learning_ai import digest, ReviewRequest, review_messages, select_sources
from backend.providers import InferenceFailure, InferenceProvider, ModelResult

ROOT = Path(__file__).resolve().parents[3] / 'data-design'
RELEASE = json.loads((ROOT/'data/curriculum.json').read_text())['release_id']


def review_request():
    return {'kind': 'review_request', 'request_id': 'REQ-00000000-0000-4000-8000-000000000001',
            'content_release_id': RELEASE, 'concept_ids': ['rag'], 'source_page_ids': ['CH01-P01'],
            'question_count': 3, 'difficulty': 'beginner'}


def draft():
    return {'questions': [{'prompt': f'복습 검증용 상황 {i}: 외부 자료를 답변에 쓰는 과정은?',
                           'options': ['검색과 생성을 연결한다', '모든 가중치를 다시 학습한다', '정확성을 보장한다', '언어 처리 전체와 같다'],
                           'answer_index': 0, 'explanation': 'RAG는 외부 자료 검색을 생성에 연결하는 시스템 구성이다.',
                           'concept_ids': ['rag'], 'source_page_ids': ['CH01-P01']} for i in range(1,4)]}


class Provider:
    def __init__(self, output=None, truncated=False, failure=None, quality=None):
        self.output = draft() if output is None else output
        self.calls = 0
        self.truncated = truncated
        self.failure = failure
        self.messages = None
        self.options = None
        self.quality = quality or {'items':[{'index':i,'accepted':True,'reason':'자료로 확인됨'} for i in range(3)]}

    async def available(self):
        return True

    async def chat(self, messages, **options):
        self.calls += 1
        if 'items' in options.get('json_schema',{}).get('properties',{}):
            return ModelResult(json.dumps(self.quality,ensure_ascii=False),{'model_ms':5,'input_tokens':80,'output_tokens':40,'truncated':False})
        self.messages, self.options = messages, options
        if self.failure:
            raise self.failure
        return ModelResult(self.output if isinstance(self.output,str) else json.dumps(self.output,ensure_ascii=False),
                           {'model_ms': 10, 'input_tokens': 120, 'output_tokens': 100, 'truncated': self.truncated})


def test_review_returns_valid_immutable_generated_questions_and_schema():
    provider = Provider()
    with TestClient(create_app(provider)) as client:
        response = client.post('/api/ai/review-quiz',json=review_request())
        assert response.status_code == 200
        body = response.json()
        assert body['review_status'] == 'unreviewed'
        assert len(body['questions']) == 3
        assert len({q['id'] for q in body['questions']}) == 3
        for q in body['questions']:
            revision = q.pop('revision')
            assert digest(q) == revision
            assert q['generation_id'] == body['generation_id']
            assert q['correct_option_id'] == q['options'][0]['id']
            assert q['chapter_ids'] == ['CH01']
        assert provider.options['json_schema']['properties']['questions']['maxItems'] == 3
        assert provider.options['max_output_tokens'] == settings.review_output_tokens
        metric = client.get('/api/last-metrics').json()['metrics']
        assert metric['api_kind'] == 'review' and metric['success'] is True
        assert not any(key in metric for key in ('message','notes','history','answer_markdown'))


@pytest.mark.parametrize('change,status', [
    ({'content_release_id': 'wrong'},409), ({'concept_ids':['missing-concept']},422),
    ({'concept_ids':['rag','rag']},422), ({'source_page_ids':['CH99-P01']},422),
    ({'source_page_ids':['CH31-P03']},422), ({'question_count':2},422),
    ({'concept_ids':[]},422), ({'source_page_ids':['CH01-P01']*11},422),
    ({'notes':'private-test-memo'},422),
])
def test_invalid_review_context_never_reaches_model(change,status):
    p = Provider()
    with TestClient(create_app(p)) as client:
        result = client.post('/api/ai/review-quiz',json={**review_request(),**change})
        assert result.status_code == status
        assert p.calls == 0
        assert 'private-test-memo' not in result.text


def test_missing_source_selection_is_resolved_from_server_content():
    p = Provider()
    with TestClient(create_app(p)) as client:
        request = review_request(); request['source_page_ids'] = []
        assert client.post('/api/ai/review-quiz',json=request).status_code == 200
        assert 'RAG는 모델 종류가 아니라' in p.messages[-1]['content']


def test_sources_focus_on_selected_concept_instead_of_broad_page_tags():
    bundle = json.loads((ROOT/'data/content-bundle.json').read_text())
    pages = {p['id']:p for p in bundle['pages']}
    concepts = {c['id']:c for c in bundle['concepts']}
    request = ReviewRequest.model_validate(review_request())
    sources = select_sources(request.concept_ids,request.source_page_ids,pages,concepts)
    assert 'CH21-P01' in [p['id'] for p in sources]
    assert 'CH01-P03' not in [p['id'] for p in sources]
    text = review_messages(request,sources)[-1]['content']
    assert '금지 단어가 들어가면 차단' not in text
    assert '형식 검사만 통과' not in text


@pytest.mark.parametrize('change', ['count','index','duplicate_option','duplicate_prompt','source','concept','extra','empty','not_json'])
def test_malformed_generated_output_is_rejected_instead_of_becoming_a_quiz(change):
    output = draft()
    if change == 'count': output['questions'].pop()
    if change == 'index': output['questions'][0]['answer_index'] = 4
    if change == 'duplicate_option': output['questions'][0]['options'][1] = output['questions'][0]['options'][0]
    if change == 'duplicate_prompt': output['questions'][1]['prompt'] = output['questions'][0]['prompt']
    if change == 'source': output['questions'][0]['source_page_ids'] = ['CH32-P03']
    if change == 'concept': output['questions'][0]['concept_ids'] = ['llm']
    if change == 'extra': output['questions'][0]['tool_call'] = 'execute'
    if change == 'empty': output['questions'][0]['explanation'] = '   '
    if change == 'not_json': output = '모델이 JSON 대신 쓴 문장'
    with TestClient(create_app(Provider(output))) as client:
        response = client.post('/api/ai/review-quiz',json=review_request())
        assert response.status_code == 502
        assert response.json()['error']['code'] == 'MODEL_INVALID_REVIEW'
        assert 'questions' not in response.json()
        assert client.get('/api/last-metrics').json()['metrics']['success'] is False


def test_truncated_json_and_model_failures_are_never_successes():
    for provider, status in [(Provider(truncated=True),502),(Provider(failure=InferenceFailure('MODEL_TIMEOUT','시간 초과',504)),504)]:
        with TestClient(create_app(provider)) as client:
            assert client.post('/api/ai/review-quiz',json=review_request()).status_code == status


def test_same_request_is_reused_and_conflicting_reuse_rejected():
    p = Provider()
    with TestClient(create_app(p)) as client:
        one = client.post('/api/ai/review-quiz',json=review_request())
        two = client.post('/api/ai/review-quiz',json=review_request())
        assert two.json() == one.json()
        assert two.headers['X-Generation-Reused'] == 'true'
        assert p.calls == 2
        request = review_request(); request['difficulty'] = 'advanced'
        assert client.post('/api/ai/review-quiz',json=request).status_code == 409
        assert p.calls == 2


def test_generated_quiz_is_rejected_if_independent_source_check_fails():
    quality={'items':[{'index':i,'accepted':i != 1,'reason':'근거 없는 용어 포함' if i == 1 else '자료로 확인됨'} for i in range(3)]}
    p=Provider(quality=quality)
    with TestClient(create_app(p)) as client:
        response=client.post('/api/ai/review-quiz',json=review_request())
        assert response.status_code==502
        assert response.json()['error']['code']=='MODEL_REVIEW_QUALITY'
        assert 'questions' not in response.json()
        metric=client.get('/api/last-metrics').json()['metrics']
        assert metric['inference_calls']==2 and metric['model_ms']==15
        assert metric['success'] is False


def test_generation_and_quality_check_share_one_total_deadline(monkeypatch):
    class SlowQuality(Provider):
        async def chat(self,messages,**options):
            if 'items' in options.get('json_schema',{}).get('properties',{}):
                await asyncio.sleep(.2)
            return await super().chat(messages,**options)
    monkeypatch.setattr('backend.app.settings',replace(settings,timeout=.02))
    with TestClient(create_app(SlowQuality())) as client:
        response=client.post('/api/ai/review-quiz',json=review_request())
        assert response.status_code==504
        assert response.json()['error']['code']=='MODEL_TIMEOUT'


def test_model_capacity_is_shared_by_tutor_and_generation():
    p = Provider(); app = create_app(p)
    with TestClient(app) as client:
        client.portal.call(app.state.inference_slot.acquire)
        try:
            assert client.post('/api/ai/review-quiz',json=review_request()).status_code == 429
            assert p.calls == 0
        finally:
            client.portal.call(app.state.inference_slot.release)


def test_tutor_reports_insufficient_context_without_fabricating_a_source():
    output = {'answer_markdown':'이 자료에는 없는 내용이어서 답하기 어려워요.', 'answer_status':'insufficient_context','source_page_ids':[]}
    request = json.loads((ROOT/'examples/tutor-request.json').read_text())
    with TestClient(create_app(Provider(output))) as client:
        response = client.post('/api/ai/tutor',json=request)
        assert response.status_code == 200
        assert response.json()['answer_status'] == 'insufficient_context'
        assert response.json()['source_page_ids'] == []


@pytest.mark.parametrize('sources,status', [([], 'grounded'), (['CH32-P03'],'grounded'), (['CH01-P01','CH01-P01'],'grounded')])
def test_tutor_source_claims_are_validated(sources,status):
    output = {'answer_markdown':'설명', 'answer_status':status, 'source_page_ids':sources}
    request = json.loads((ROOT/'examples/tutor-request.json').read_text())
    with TestClient(create_app(Provider(output))) as client:
        response = client.post('/api/ai/tutor',json=request)
        assert response.status_code == 502
        assert response.json()['error']['code'] == 'MODEL_INVALID_TUTOR'


@pytest.mark.parametrize('kind', ['ollama','openai_compatible'])
def test_provider_sends_json_schema_and_operation_specific_output_limit(kind):
    schema = {'type':'object','properties':{'answer':{'type':'string'}},'required':['answer'],'additionalProperties':False}
    def handler(request):
        body = json.loads(request.content)
        if kind == 'ollama':
            assert body['format'] == schema
            assert body['options']['num_predict'] == 2000
            assert body['options']['num_ctx'] == settings.structured_context
            return httpx.Response(200,json={'message':{'content':'{"answer":"응답"}'},'done':True,'done_reason':'stop'})
        assert body['response_format']['json_schema']['schema'] == schema
        assert body['max_tokens'] == 2000
        return httpx.Response(200,json={'choices':[{'message':{'content':'{"answer":"응답"}'},'finish_reason':'stop'}]})
    p = InferenceProvider(replace(settings,provider=kind),httpx.MockTransport(handler))
    result = asyncio.run(p.chat([{'role':'user','content':'질문'}],json_schema=schema,max_output_tokens=2000))
    assert json.loads(result.text)['answer'] == '응답'
