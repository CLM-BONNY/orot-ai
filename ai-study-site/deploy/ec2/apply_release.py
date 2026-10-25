"""Runs on the CPU EC2 host via SSM. Secrets stay on the host, out of command payloads."""
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.request import urlopen
from urllib.parse import urlparse

ROOT=Path('/opt/orot')


def run(args):
    result=subprocess.run(args,text=True,capture_output=True,timeout=600)
    if result.returncode:raise RuntimeError(f'Command failed: {args[0]}; inspect host/container logs')
    return result.stdout


def validate(payload):
    if not re.fullmatch(r'[a-f0-9]{40}',payload['revision']):raise ValueError('Invalid source revision')
    if not re.fullmatch(r'[a-f0-9]{40}-[0-9]+-[0-9]+',payload['release_id']):raise ValueError('Invalid release ID')
    for key in ['API_IMAGE','WEB_IMAGE']:
        if not re.fullmatch(r'[0-9]{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com/[^\s@]+@sha256:[a-f0-9]{64}',payload['env'][key]):
            raise ValueError('Deploy immutable private ECR image digests')
    if payload['env']['APP_REVISION']!=payload['revision']:raise ValueError('Revision mismatch')
    for key,value in payload['env'].items():
        if not re.fullmatch(r'[A-Z_]+',key) or not isinstance(value,str) or any(c in value for c in '\r\n$\"\''):
            raise ValueError('Invalid non-secret environment value')
    if not re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}',payload['env']['APP_DOMAIN']):
        raise ValueError('Use a domain name without a scheme or port')
    provider=payload['env'].get('INFERENCE_PROVIDER','openai_compatible')
    if provider not in ['disabled','openai_compatible']:raise ValueError('Unsupported deployment inference provider')
    if provider!='disabled':
        address=urlparse(payload['env']['INFERENCE_BASE_URL'])
        ip=ipaddress.ip_address(address.hostname or '')
        if address.scheme!='http' or address.port!=8000 or address.path!='/v1' or address.username or address.query or address.fragment or not any(ip in ipaddress.ip_network(cidr) for cidr in ['10.0.0.0/8','172.16.0.0/12','192.168.0.0/16']):
            raise ValueError('Use the GPU private IP on port 8000 with /v1')
    if provider=='disabled' and 'inference_token' in payload.get('secrets',{}):
        raise ValueError('Disabled AI release must not request inference credentials')
    if provider=='disabled' and 'compose.inference.yml' in payload.get('files',{}):
        raise ValueError('Disabled AI release must not include inference configuration')
    if provider=='openai_compatible' and payload['env'].get('INFERENCE_PROVIDER'):
        if not payload.get('secrets',{}).get('inference_token') or 'compose.inference.yml' not in payload.get('files',{}):
            raise ValueError('Enabled AI release requires inference configuration and credentials')
    if payload['env'].get('SECRETS_DIR')!=f"/opt/orot/releases/{payload['release_id']}/secrets":
        raise ValueError('Secrets must belong to this release')
    return payload


def compose(folder):
    args=['docker','compose','--env-file',str(folder/'.env'),'-f',str(folder/'compose.yml')]
    if (folder/'compose.inference.yml').is_file():args+=['-f',str(folder/'compose.inference.yml')]
    return args


def activate(folder,revision):
    run(compose(folder)+['up','-d','--wait','--wait-timeout','120'])
    for path in ['/api/health','/release.json']:
        with urlopen('http://127.0.0.1:8081'+path,timeout=10) as response:
            if json.load(response).get('code_revision')!=revision:raise RuntimeError('Host revision check failed')


def link_current(folder):
    temporary=ROOT/'next'
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(folder)
    os.replace(temporary,ROOT/'current')


def rollback():
    previous=ROOT/'previous'
    if not previous.is_symlink():raise RuntimeError('No earlier release exists for rollback')
    folder=previous.resolve()
    revision=json.loads((folder/'release.json').read_text())['revision']
    activate(folder,revision)
    link_current(folder)
    print(json.dumps({'rollback':True,'revision':revision}))


def apply(payload):
    payload=validate(payload)
    ROOT.mkdir(mode=0o700,parents=True,exist_ok=True)
    old=(ROOT/'current').resolve() if (ROOT/'current').is_symlink() else None
    folder=ROOT/'releases'/payload['release_id']
    folder.mkdir(mode=0o700,parents=True,exist_ok=True)
    secret_folder=folder/'secrets';secret_folder.mkdir(mode=0o700,exist_ok=True)
    for name,arn in payload['secrets'].items():
        if name not in ['inference_token','site_login']:raise ValueError('Unknown secret target')
        value=run(['aws','secretsmanager','get-secret-value','--secret-id',arn,'--query','SecretString','--output','text']).strip()
        if not value:raise ValueError('Empty secret')
        path=secret_folder/name;path.write_text(value+'\n');path.chmod(0o644)
    for name in ['compose.yml','Caddyfile']:(folder/name).write_text(payload['files'][name])
    if 'compose.inference.yml' in payload['files']:
        (folder/'compose.inference.yml').write_text(payload['files']['compose.inference.yml'])
    else:
        (folder/'compose.inference.yml').unlink(missing_ok=True)
    (folder/'.env').write_text(''.join(f'{k}={v}\n' for k,v in payload['env'].items()))
    (folder/'release.json').write_text(json.dumps({'revision':payload['revision'],'release_id':payload['release_id']}))
    registry=payload['env']['API_IMAGE'].split('/')[0]
    password=run(['aws','ecr','get-login-password','--region',payload['env']['AWS_REGION']]).strip()
    login=subprocess.run(['docker','login','--username','AWS','--password-stdin',registry],input=password,text=True,capture_output=True)
    if login.returncode:raise RuntimeError('ECR login failed')
    try:
        run(compose(folder)+['pull'])
        activate(folder,payload['revision'])
    except Exception:
        if old:activate(old,json.loads((old/'release.json').read_text())['revision'])
        raise
    if old:
        previous=ROOT/'previous';previous.unlink(missing_ok=True);previous.symlink_to(old)
    link_current(folder)
    print(json.dumps({'verified_on_host':True,'revision':payload['revision'],'release_id':payload['release_id']}))


if __name__=='__main__':
    if '--rollback' in sys.argv:rollback()
    else:apply(json.load(sys.stdin))
