"""CI-side deployment over SSM; no SSH keys and no secrets in command payloads."""
import argparse
import base64
import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import time
from urllib.request import urlopen

HERE=Path(__file__).resolve().parent


def aws(*args,body=None):
    command=['aws',*args,'--output','json']
    if body is None:
        result=subprocess.run(command,text=True,capture_output=True,check=True,timeout=60)
    else:
        # AWS CLI parameter-file loading does not reliably accept /dev/stdin.
        with tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',suffix='.json') as request:
            json.dump(body,request);request.flush()
            result=subprocess.run(command+['--cli-input-json','file://'+request.name],
                                  text=True,capture_output=True,check=True,timeout=60)
    return json.loads(result.stdout)


def execute(instance,commands):
    sent=aws('ssm','send-command',body={
        'InstanceIds':[instance],'DocumentName':'AWS-RunShellScript','TimeoutSeconds':600,
        'Parameters':{'commands':commands,'executionTimeout':['600']}})
    command_id=sent['Command']['CommandId'];deadline=time.monotonic()+900
    while time.monotonic()<deadline:
        try:status=aws('ssm','get-command-invocation','--command-id',command_id,'--instance-id',instance)
        except subprocess.CalledProcessError as e:
            if 'InvocationDoesNotExist' in e.stderr:time.sleep(3);continue
            raise
        if status['Status']=='Success':return status.get('StandardOutputContent','')
        if status['Status'] not in ['Pending','InProgress','Delayed']:raise RuntimeError(f'SSM deployment failed ({command_id}); inspect command stderr in AWS')
        time.sleep(5)
    raise TimeoutError(f'SSM command {command_id} exceeded deployment deadline')


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--rollback',action='store_true');args=parser.parse_args()
    instance=os.environ['APP_INSTANCE_ID']
    if args.rollback:
        print(execute(instance,['set -eu','python3 /opt/orot/apply_release.py --rollback']));return
    env={key:os.environ[key] for key in ['API_IMAGE','WEB_IMAGE','APP_REVISION','APP_DOMAIN','AWS_REGION']}
    provider=os.getenv('INFERENCE_PROVIDER','disabled')
    env['INFERENCE_PROVIDER']=provider
    files={name:(HERE/name).read_text() for name in ['compose.yml','Caddyfile']}
    secrets={'site_login':os.environ['SITE_LOGIN_SECRET_ARN']}
    if provider=='openai_compatible':
        env.update({key:os.environ[key] for key in ['INFERENCE_BASE_URL','MODEL_NAME']})
        secrets['inference_token']=os.environ['INFERENCE_SECRET_ARN']
        files['compose.inference.yml']=(HERE/'compose.inference.yml').read_text()
    env['SECRETS_DIR']=f"/opt/orot/releases/{os.environ['RELEASE_ID']}/secrets"
    payload={'revision':env['APP_REVISION'],'release_id':os.environ['RELEASE_ID'],'env':env,
             'files':files,'secrets':secrets}
    import importlib.util
    spec=importlib.util.spec_from_file_location('host_apply',HERE/'apply_release.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    module.validate(payload)
    script=base64.b64encode((HERE/'apply_release.py').read_bytes()).decode()
    data=base64.b64encode(json.dumps(payload).encode()).decode()
    commands=['set -eu','umask 077','mkdir -p /opt/orot',
              f'printf %s {shlex.quote(script)} | base64 -d > /opt/orot/apply_release.py',
              f'printf %s {shlex.quote(data)} | base64 -d | python3 /opt/orot/apply_release.py']
    execute(instance,commands)
    try:
        deadline=time.monotonic()+120
        while True:
            try:
                for path in ['/api/health','/release.json']:
                    with urlopen('https://'+env['APP_DOMAIN']+path,timeout=20) as response:
                        if json.load(response).get('code_revision')!=env['APP_REVISION']:raise RuntimeError('Public HTTPS revision mismatch')
                break
            except Exception:
                if time.monotonic()>=deadline:raise
                time.sleep(3)
    except Exception:
        execute(instance,['set -eu','python3 /opt/orot/apply_release.py --rollback'])
        raise
    print(json.dumps({'verified':True,'release_id':payload['release_id'],'revision':payload['revision'],
                      'url':'https://'+env['APP_DOMAIN'],'images':{'api':env['API_IMAGE'],'web':env['WEB_IMAGE']}}))


if __name__=='__main__':main()
