from dataclasses import dataclass
import os
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]


def read_local_env():
    path = PROJECT / '.env.local'
    if path.is_file():
        for line in path.read_text().splitlines():
            key, separator, value = line.strip().partition('=')
            if separator and key and not key.startswith('#'):
                os.environ.setdefault(key, value.strip().strip('\"\''))


read_local_env()


def inference_token():
    path = os.getenv('INFERENCE_AUTH_TOKEN_FILE')
    return Path(path).read_text().strip() if path else os.getenv('INFERENCE_AUTH_TOKEN', '')


@dataclass(frozen=True)
class Settings:
    provider: str = os.getenv('INFERENCE_PROVIDER', 'ollama')
    base_url: str = os.getenv('INFERENCE_BASE_URL', 'http://127.0.0.1:11535').rstrip('/')
    model: str = os.getenv('MODEL_NAME', 'qwen3.5:9b-q4_K_M')
    timeout: float = float(os.getenv('INFERENCE_TIMEOUT_SECONDS', '180'))
    max_output_tokens: int = int(os.getenv('MAX_OUTPUT_TOKENS', '384'))
    review_output_tokens: int = int(os.getenv('REVIEW_MAX_OUTPUT_TOKENS', '1536'))
    structured_context: int = int(os.getenv('STRUCTURED_CONTEXT_LENGTH', '4096'))
    data_dir: Path = Path(os.getenv('CONTENT_DATA_DIR', str(PROJECT.parent / 'data-design/data')))
    auth_token: str = inference_token()
    serve_frontend: bool = os.getenv('SERVE_FRONTEND', 'false').lower() == 'true'
    frontend_dir: Path = Path(os.getenv('FRONTEND_DIST_DIR', str(PROJECT / 'frontend/dist')))


settings = Settings()
