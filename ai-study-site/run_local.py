"""Start the local reader/API/model; Ctrl+C stops only processes this script owns."""
import os
import argparse
from pathlib import Path
import shutil
import subprocess
import sys
import time
from urllib.parse import urlparse
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent


def ready(url):
    try:
        with urlopen(url, timeout=2) as response:
            return response.status == 200
    except Exception:
        return False


def wait_ready(url, process, seconds=15):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError('실행 프로세스가 종료됐어요. 위 오류를 확인해 주세요.')
        if ready(url):
            return
        time.sleep(0.25)
    raise RuntimeError(f'서버 준비 시간을 초과했어요: {url}')


def main():
    parser = argparse.ArgumentParser(description='로컬 AI 학습 사이트 실행')
    parser.add_argument('--production', action='store_true', help='빌드된 화면과 API를 한 포트에서 실행')
    parser.add_argument('--without-model', action='store_true', help='모델을 시작하지 않고 기본 학습 기능 실행')
    args = parser.parse_args()
    os.chdir(ROOT)
    from backend.config import settings
    api_port = int(os.getenv('AI_STUDY_API_PORT', '8018'))
    frontend_port = int(os.getenv('AI_STUDY_FRONTEND_PORT', '5178'))
    api_url = f'http://127.0.0.1:{api_port}'
    frontend_url = f'http://127.0.0.1:{frontend_port}'
    if args.production and not (ROOT / 'frontend/dist/index.html').is_file():
        raise RuntimeError('frontend에서 npm run build를 먼저 실행해 주세요.')
    if not args.production and not (ROOT / 'frontend/node_modules').is_dir():
        raise RuntimeError('먼저 frontend 폴더에서 npm ci를 실행해 주세요.')
    if not args.production and not shutil.which('npm'):
        raise RuntimeError('Node.js와 npm이 필요해요.')
    if (not args.production and ready(api_url + '/api/health')) or ready(frontend_url + '/'):
        raise RuntimeError(f'{api_port} 또는 {frontend_port} 포트에 서버가 이미 실행 중이에요. 기존 서버를 사용하거나 먼저 종료해 주세요.')
    children = []
    try:
        model_health = settings.base_url + ('/api/tags' if settings.provider == 'ollama' else '/models')
        if not args.without_model and not ready(model_health):
            binary, models = os.getenv('OLLAMA_BINARY'), os.getenv('OLLAMA_MODELS')
            address = urlparse(settings.base_url)
            if settings.provider != 'ollama' or address.hostname not in ('localhost', '127.0.0.1'):
                raise RuntimeError('설정한 모델 서버에 연결할 수 없어요. 모델 서버를 먼저 실행해 주세요.')
            if not binary or not Path(binary).is_file() or not models or not Path(models).is_dir():
                raise RuntimeError('.env.local의 OLLAMA_BINARY와 OLLAMA_MODELS 경로를 확인해 주세요.')
            env = {**os.environ, 'OLLAMA_HOST': address.netloc, 'OLLAMA_MODELS': models,
                   'OLLAMA_NOPRUNE': 'true', 'OLLAMA_NO_CLOUD': 'true',
                   'OLLAMA_CONTEXT_LENGTH': str(settings.structured_context), 'OLLAMA_NUM_PARALLEL': '1',
                   'OLLAMA_MAX_LOADED_MODELS': '1'}
            model = subprocess.Popen([binary, 'serve'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            children.append(model)
            wait_ready(model_health, model)
        serving_port = frontend_port if args.production else api_port
        api = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'backend.app:app', '--host', '127.0.0.1', '--port', str(serving_port), '--workers', '1'], cwd=ROOT,
                               env={**os.environ, 'SERVE_FRONTEND': str(args.production).lower()})
        children.append(api)
        wait_ready((frontend_url if args.production else api_url) + '/api/health', api)
        if not args.production:
            frontend = subprocess.Popen(['npm', 'run', 'dev', '--', '--port', str(frontend_port)], cwd=ROOT / 'frontend',
                                    env={**os.environ, 'AI_STUDY_API_URL': api_url})
            children.append(frontend)
            wait_ready(frontend_url + '/', frontend)
        print(f'\n학습 사이트: {frontend_url}/notebook', flush=True)
        print('종료: Ctrl+C (이 실행이 시작한 프로세스만 종료합니다.)\n', flush=True)
        while all(child.poll() is None for child in children):
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        for process in reversed(children):
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ImportError) as exc:
        print(f'실행 준비가 필요해요: {exc}', file=sys.stderr)
        sys.exit(1)
