"""GPU-host rollout over SSM. Token stays on the host; model cache survives stops."""
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from urllib.request import Request, urlopen

ROOT=Path('/opt/orot-inference')


def validate(payload):
    env=payload['env']
    if not re.fullmatch(r'[a-f0-9]{40}-[0-9]+-[0-9]+',payload['release_id']):raise ValueError('Invalid release ID')
    if not re.fullmatch(r'[0-9]{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com/orot-ai-inference@sha256:[a-f0-9]{64}',env['INFERENCE_IMAGE']):
        raise ValueError('Use the immutable Orot inference ECR image')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',env['MODEL_REPO']):raise ValueError('Invalid model repository')
    if not re.fullmatch(r'[a-f0-9]{40}',env['MODEL_REVISION']):raise ValueError('Pin the model commit')
    address=ipaddress.ip_address(env['PRIVATE_IPV4'])
    if address.version!=4 or not any(address in ipaddress.ip_network(x) for x in ['10.0.0.0/8','172.16.0.0/12','192.168.0.0/16']):
        raise ValueError('Bind inference only to the private IPv4')
    expected=str(ROOT/'releases'/payload['release_id']/'secrets')
    if env['SECRETS_DIR']!=expected:raise ValueError('Use release-scoped secrets')
    for key,value in env.items():
        if not re.fullmatch(r'[A-Z][A-Z0-9_]*',key) or not isinstance(value,str) or any(c in value for c in '\r\n$\"\''):
            raise ValueError('Invalid non-secret configuration')
    return payload


def run(args,timeout=1800):
    result=subprocess.run(args,text=True,capture_output=True,timeout=timeout)
    if result.returncode:raise RuntimeError('GPU host command failed; inspect SSM and inference logs without printing credentials')
    return result.stdout


def compose(folder):
    return ['docker','compose','--env-file',str(folder/'.env'),'-f',str(folder/'compose.yml')]


def wait_ready(model,token,seconds=1800):
    deadline=time.monotonic()+seconds
    while time.monotonic()<deadline:
        try:
            request=Request('http://127.0.0.1:8000/v1/models',headers={'Authorization':'Bearer '+token})
            with urlopen(request,timeout=10) as r:
                if model in [x['id'] for x in json.load(r)['data']]:return
        except (OSError,ValueError,KeyError):pass
        time.sleep(10)
    raise TimeoutError('GPU model readiness deadline exceeded')


def apply(payload):
    payload=validate(payload)
    # Fail before touching secrets if this is a CPU host or an unguarded machine.
    run(['systemctl','is-active','orot-gpu-stop.timer'],timeout=15)
    run(['nvidia-smi','--query-gpu=name,memory.total','--format=csv,noheader'],timeout=30)
    env=payload['env'];ROOT.mkdir(mode=0o700,parents=True,exist_ok=True)
    old=(ROOT/'current').resolve() if (ROOT/'current').is_symlink() else None
    folder=ROOT/'releases'/payload['release_id'];folder.mkdir(mode=0o700,parents=True,exist_ok=True)
    secrets=folder/'secrets';secrets.mkdir(mode=0o700,exist_ok=True)
    token=run(['aws','secretsmanager','get-secret-value','--region',env['AWS_REGION'],'--secret-id',payload['secret_arn'],'--query','SecretString','--output','text'],timeout=60).strip()
    if not token:raise ValueError('Empty inference token')
    secret=secrets/'inference_token';secret.write_text(token+'\n');secret.chmod(0o600)
    (ROOT/'model-cache').mkdir(mode=0o700,exist_ok=True)
    (folder/'compose.yml').write_text(payload['compose'])
    (folder/'.env').write_text(''.join(f'{k}={v}\n' for k,v in env.items()))
    (folder/'release.json').write_text(json.dumps({'release_id':payload['release_id'],'model_repo':env['MODEL_REPO'],'model_revision':env['MODEL_REVISION'],'image':env['INFERENCE_IMAGE']}))
    registry=env['INFERENCE_IMAGE'].split('/')[0]
    password=run(['aws','ecr','get-login-password','--region',env['AWS_REGION']],timeout=60).strip()
    result=subprocess.run(['docker','login','--username','AWS','--password-stdin',registry],input=password,text=True,capture_output=True,timeout=60)
    if result.returncode:raise RuntimeError('Inference ECR login failed')
    try:
        run(compose(folder)+['pull'])
        run(compose(folder)+['up','-d'])
        wait_ready(env['MODEL_NAME'],token)
    except Exception:
        if old:run(compose(old)+['up','-d'])
        else:run(compose(folder)+['down'],timeout=120)
        raise
    if old:
        previous=ROOT/'previous';previous.unlink(missing_ok=True);previous.symlink_to(old)
    next_link=ROOT/'next';next_link.unlink(missing_ok=True);next_link.symlink_to(folder);os.replace(next_link,ROOT/'current')
    print(json.dumps({'model_ready':True,'release_id':payload['release_id'],'model_revision':env['MODEL_REVISION'],'image':env['INFERENCE_IMAGE'],'endpoint':'http://'+env['PRIVATE_IPV4']+':8000/v1'}))


if __name__=='__main__':apply(json.load(sys.stdin))
