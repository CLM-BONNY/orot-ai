"""Self-hosted inference adapter. This never calls OpenAI's service."""
import asyncio
from dataclasses import dataclass
import time

import httpx

from .config import Settings


class InferenceFailure(Exception):
    def __init__(self, code, message, status=502):
        self.code, self.message, self.status = code, message, status


@dataclass
class ModelResult:
    text: str
    metrics: dict


class InferenceProvider:
    def __init__(self, config: Settings, transport=None):
        if config.provider not in ('ollama', 'openai_compatible', 'disabled'):
            raise ValueError('Unsupported inference provider')
        self.config = config
        self.transport = transport

    async def available(self):
        if self.config.provider == 'disabled':
            return False
        endpoint = '/api/tags' if self.config.provider == 'ollama' else '/models'
        try:
            async with httpx.AsyncClient(timeout=3, transport=self.transport, trust_env=False) as client:
                result = await client.get(self.config.base_url + endpoint, headers=self.headers())
                result.raise_for_status()
                data = result.json()
                names = [m.get('name') for m in data.get('models', [])] if self.config.provider == 'ollama' else [m.get('id') for m in data.get('data', [])]
                return self.config.model in names
        except (httpx.HTTPError, ValueError):
            return False

    def headers(self):
        return {'Authorization': f'Bearer {self.config.auth_token}'} if self.config.auth_token else {}

    async def chat(self, messages, *, json_schema=None, max_output_tokens=None):
        if self.config.provider == 'disabled':
            raise InferenceFailure('MODEL_DISABLED', '현재 AI 실험 서버가 꺼져 있어요. 글 읽기와 기본 퀴즈는 계속 사용할 수 있어요.', 503)
        try:
            return await asyncio.wait_for(self._chat(messages, json_schema, max_output_tokens), timeout=self.config.timeout)
        except (asyncio.TimeoutError, httpx.TimeoutException) as exc:
            raise InferenceFailure('MODEL_TIMEOUT', '모델 응답 시간이 초과됐어요. 잠시 후 다시 시도해 주세요.', 504) from exc
        except httpx.ConnectError as exc:
            raise InferenceFailure('MODEL_UNAVAILABLE', '모델 서버에 연결할 수 없어요. 실행 상태를 확인해 주세요.', 503) from exc
        except httpx.HTTPStatusError as exc:
            code = 'MODEL_RATE_LIMITED' if exc.response.status_code == 429 else 'MODEL_ERROR'
            raise InferenceFailure(code, '모델 서버가 요청을 처리하지 못했어요.', 429 if code == 'MODEL_RATE_LIMITED' else 502) from exc
        except (httpx.HTTPError, KeyError, ValueError, TypeError, IndexError) as exc:
            raise InferenceFailure('MODEL_INVALID_RESPONSE', '모델 응답을 읽지 못했어요. 다시 시도해 주세요.') from exc

    async def _chat(self, messages, json_schema=None, max_output_tokens=None):
        start = time.perf_counter()
        output_limit = max_output_tokens or self.config.max_output_tokens
        if self.config.provider == 'ollama':
            endpoint = '/api/chat'
            payload = {'model': self.config.model, 'messages': messages, 'stream': False,
                       'think': False, 'keep_alive': '10m',
                       'options': {'num_ctx': self.config.structured_context if json_schema else 4096, 'num_predict': output_limit,
                                   'temperature': 0.2}}
            if json_schema:
                payload['format'] = json_schema
        else:
            endpoint = '/chat/completions'
            payload = {'model': self.config.model, 'messages': messages, 'stream': False,
                       'max_tokens': output_limit, 'temperature': 0.2}
            if json_schema:
                payload['response_format'] = {'type': 'json_schema', 'json_schema': {
                    'name': 'learning_response', 'strict': True, 'schema': json_schema}}
        async with httpx.AsyncClient(timeout=self.config.timeout, transport=self.transport, trust_env=False) as client:
            response = await client.post(self.config.base_url + endpoint, json=payload, headers=self.headers())
            response.raise_for_status()
            data = response.json()
        metrics = {'model_ms': round((time.perf_counter()-start)*1000, 2), 'provider': self.config.provider,
                   'model': self.config.model}
        if self.config.provider == 'ollama':
            text = data['message']['content'].strip()
            if not data.get('done'):
                raise ValueError('Incomplete response')
            metrics.update({'input_tokens': data.get('prompt_eval_count'), 'output_tokens': data.get('eval_count'),
                            'load_ms': round(data.get('load_duration', 0)/1_000_000, 2),
                            'done_reason': data.get('done_reason')})
        else:
            choice = data['choices'][0]
            text = choice['message']['content'].strip()
            usage = data.get('usage', {})
            metrics.update({'input_tokens': usage.get('prompt_tokens'), 'output_tokens': usage.get('completion_tokens'),
                            'load_ms': None, 'done_reason': choice.get('finish_reason')})
        if not text:
            raise ValueError('Empty model response')
        metrics['truncated'] = metrics['done_reason'] in ('length', 'max_tokens')
        return ModelResult(text=text, metrics=metrics)
