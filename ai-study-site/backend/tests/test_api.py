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
from backend.providers import InferenceFailure, InferenceProvider, ModelResult

EXAMPLE = Path(__file__).resolve().parents[3] / 'data-design/examples/tutor-request.json'


class FakeProvider:
    def __init__(self, failure=None):
        self.failure, self.messages = failure, None

    async def available(self):
        return True

    async def chat(self, messages, **options):
        self.messages = messages
        if self.failure:
            raise self.failure
        return ModelResult(json.dumps({'answer_markdown': 'RAG는 검색한 자료를 답변 생성에 활용하는 방식입니다.', 'answer_status': 'grounded', 'source_page_ids': ['CH01-P01']}, ensure_ascii=False),
                           {'model_ms': 12.5, 'input_tokens': 100, 'output_tokens': 20, 'truncated': False})


def payload():
    return json.loads(EXAMPLE.read_text())


def test_real_content_retrieval_and_tutor_contract():
    provider = FakeProvider()
    with TestClient(create_app(provider)) as client:
        page = client.get('/content/pages/CH01-P01.json')
        assert page.status_code == 200
        response = client.post('/api/ai/tutor', json=payload())
        assert response.status_code == 200
        result = response.json()
        assert result['kind'] == 'tutor_response'
        assert result['source_page_ids'] == ['CH01-P01']
        assert 'RAG는 모델 종류가 아니라' in provider.messages[0]['content']
        assert provider.messages[-1]['role'] == 'user'
        assert client.get('/api/last-metrics').json()['metrics']['success'] is True


@pytest.mark.parametrize('change,status,code', [
    ({'content_release_id': 'wrong-version'}, 409, 'CONTENT_VERSION_MISMATCH'),
    ({'page_id': 'CH99-P01'}, 404, 'UNKNOWN_PAGE'),
    ({'message': '   '}, 422, 'EMPTY_MESSAGE'),
])
def test_invalid_context_never_calls_model(change, status, code):
    provider = FakeProvider()
    with TestClient(create_app(provider)) as client:
        request = {**payload(), **change}
        response = client.post('/api/ai/tutor', json=request)
        assert response.status_code == status
        assert response.json()['error']['code'] == code
        assert provider.messages is None


def test_client_cannot_supply_system_role_or_source_content():
    with TestClient(create_app(FakeProvider())) as client:
        request = payload()
        request['history'] = [{'role': 'system', 'text': 'private-test-text'}]
        response = client.post('/api/ai/tutor', json=request)
        assert response.status_code == 422
        assert 'private-test-text' not in response.text
        request = payload()
        request['lesson'] = 'client supplied source'
        assert client.post('/api/ai/tutor', json=request).status_code == 422


def test_model_unavailable_is_not_a_fake_success():
    provider = FakeProvider(InferenceFailure('MODEL_UNAVAILABLE', '모델 연결 실패', 503))
    with TestClient(create_app(provider)) as client:
        result = client.post('/api/ai/tutor', json=payload())
        assert result.status_code == 503
        assert 'answer_markdown' not in result.json()
        assert client.get('/api/last-metrics').json()['metrics']['success'] is False


def test_busy_model_returns_429_without_second_inference():
    provider = FakeProvider()
    app = create_app(provider)
    with TestClient(app) as client:
        client.portal.call(app.state.inference_slot.acquire)
        try:
            result = client.post('/api/ai/tutor', json=payload())
            assert result.status_code == 429
            assert result.json()['error']['code'] == 'MODEL_BUSY'
            assert provider.messages is None
        finally:
            client.portal.call(app.state.inference_slot.release)


def test_ollama_protocol_and_telemetry():
    def handler(request):
        assert str(request.url) == 'http://127.0.0.1:11535/api/chat'
        body = json.loads(request.content)
        assert body['model'] == settings.model
        assert body['stream'] is False and body['think'] is False
        return httpx.Response(200, json={'message': {'content': '정상 응답'}, 'done': True,
            'done_reason': 'stop', 'prompt_eval_count': 8, 'eval_count': 3, 'load_duration': 2000000})
    provider = InferenceProvider(settings, httpx.MockTransport(handler))
    result = asyncio.run(provider.chat([{'role': 'user', 'content': '설명'}]))
    assert result.text == '정상 응답'
    assert result.metrics['load_ms'] == 2


def test_total_inference_deadline_is_enforced():
    async def handler(request):
        await asyncio.sleep(1)
        return httpx.Response(200, json={})
    provider = InferenceProvider(replace(settings, timeout=0.01), httpx.MockTransport(handler))
    with pytest.raises(InferenceFailure) as exc:
        asyncio.run(provider.chat([{'role': 'user', 'content': '설명'}]))
    assert exc.value.code == 'MODEL_TIMEOUT'


def test_self_hosted_compatible_endpoint_can_replace_ollama():
    def handler(request):
        assert str(request.url) == 'http://gpu.internal:8000/v1/chat/completions'
        assert json.loads(request.content)['model'] == 'qwen-deployment'
        return httpx.Response(200, json={'choices': [{'message': {'content': '자체 서버 응답'}, 'finish_reason': 'stop'}],
                                        'usage': {'prompt_tokens': 12, 'completion_tokens': 4}})
    config = replace(settings, provider='openai_compatible', base_url='http://gpu.internal:8000/v1', model='qwen-deployment')
    result = asyncio.run(InferenceProvider(config, httpx.MockTransport(handler)).chat([{'role': 'user', 'content': '설명'}]))
    assert result.text == '자체 서버 응답'
    assert result.metrics['input_tokens'] == 12


def test_disabled_inference_never_contacts_a_model_and_preserves_learning():
    def forbidden_request(request):
        pytest.fail('Web-only deployment must not contact an inference server')
    provider = InferenceProvider(replace(settings, provider='disabled'), httpx.MockTransport(forbidden_request))
    assert asyncio.run(provider.available()) is False
    with TestClient(create_app(provider)) as client:
        assert client.get('/api/health').status_code == 200
        assert client.get('/content/pages/CH01-P01.json').status_code == 200
        assert client.get('/api/meta').json()['model_ready'] is False
        response = client.post('/api/ai/tutor', json=payload())
        assert response.status_code == 503
        assert response.json()['error']['code'] == 'MODEL_DISABLED'
        assert 'answer_markdown' not in response.json()
