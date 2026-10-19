"""Launch a pinned self-hosted model; checkpoint files live in a mounted cache."""
import os
import re


def command(env):
    repo = env.get('MODEL_REPO', '')
    revision = env.get('MODEL_REVISION', '')
    served = env.get('MODEL_NAME', '')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo):
        raise ValueError('MODEL_REPO must name an explicit model repository')
    if not re.fullmatch(r'[a-f0-9]{40}', revision):
        raise ValueError('MODEL_REVISION must be the full checkpoint commit SHA')
    if not served or not env.get('VLLM_API_KEY'):
        raise ValueError('MODEL_NAME and VLLM_API_KEY are required')
    length = int(env.get('MAX_MODEL_LEN', '4096'))
    utilization = float(env.get('GPU_MEMORY_UTILIZATION', '0.85'))
    if length < 1024 or length > 131072 or not 0 < utilization <= .95:
        raise ValueError('Invalid context length or GPU memory utilization')
    return ['vllm', 'serve', repo, '--revision', revision, '--served-model-name', served,
            '--host', '0.0.0.0', '--port', '8000', '--max-model-len', str(length),
            '--gpu-memory-utilization', str(utilization)]


if __name__ == '__main__':
    args = command(os.environ)
    os.execvp(args[0], args)
