"""Launch a pinned self-hosted model; checkpoint files live in a mounted cache."""
import os
import re
from pathlib import Path


def auth_token(env):
    path = env.get('VLLM_API_KEY_FILE')
    return Path(path).read_text().strip() if path else env.get('VLLM_API_KEY', '')


def command(env):
    repo = env.get('MODEL_REPO', '')
    revision = env.get('MODEL_REVISION', '')
    served = env.get('MODEL_NAME', '')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo):
        raise ValueError('MODEL_REPO must name an explicit model repository')
    if not re.fullmatch(r'[a-f0-9]{40}', revision):
        raise ValueError('MODEL_REVISION must be the full checkpoint commit SHA')
    if not served or not auth_token(env):
        raise ValueError('MODEL_NAME and an inference access token are required')
    length = int(env.get('MAX_MODEL_LEN', '4096'))
    utilization = float(env.get('GPU_MEMORY_UTILIZATION', '0.85'))
    sequences = int(env.get('MAX_NUM_SEQS', '4'))
    if length < 1024 or length > 131072 or not 0 < utilization <= .95 or not 1 <= sequences <= 32:
        raise ValueError('Invalid context length or GPU memory utilization')
    args = ['vllm', 'serve', repo, '--revision', revision, '--tokenizer-revision', revision, '--served-model-name', served,
            '--host', '0.0.0.0', '--port', '8000', '--max-model-len', str(length),
            '--gpu-memory-utilization', str(utilization), '--max-num-seqs', str(sequences),
            '--dtype', 'bfloat16', '--reasoning-parser', 'qwen3', '--disable-log-requests',
            '--default-chat-template-kwargs', '{"enable_thinking":false}']
    for key,flag in [('LANGUAGE_MODEL_ONLY','--language-model-only'),('ENFORCE_EAGER','--enforce-eager')]:
        value=env.get(key,'true').lower()
        if value not in ['true','false']:raise ValueError('Boolean inference options must be true or false')
        if value=='true':args.append(flag)
    return args


if __name__ == '__main__':
    args = command(os.environ)
    os.environ['VLLM_API_KEY'] = auth_token(os.environ)
    os.execvp(args[0], args)
