"""CI controller for an already-running GPU. It cannot create or start EC2 instances."""
import base64
import importlib.util
import json
import os
from pathlib import Path
import shlex
import sys
import time

from deploy import aws

HERE=Path(__file__).resolve().parent.parent/'inference'


def payload_from_env(env):
    lock=json.loads((HERE/'model-lock.json').read_text())
    release_id=env['RELEASE_ID']
    payload={'release_id':release_id,'secret_arn':env['INFERENCE_SECRET_ARN'],
             'env':{'INFERENCE_IMAGE':env['INFERENCE_IMAGE'],'AWS_REGION':env['AWS_REGION'],
                    'PRIVATE_IPV4':env['GPU_PRIVATE_IPV4'],'MODEL_REPO':lock['model_repo'],
                    'MODEL_REVISION':lock['model_revision'],'MODEL_NAME':'orot-qwen3.5-9b',
                    'MAX_MODEL_LEN':str(lock['max_model_len']),'MAX_NUM_SEQS':str(lock['max_num_seqs']),
                    'GPU_MEMORY_UTILIZATION':str(lock['gpu_memory_utilization']),
                    'SECRETS_DIR':'/opt/orot-inference/releases/'+release_id+'/secrets'},
             'compose':(HERE/'compose.yml').read_text()}
    spec=importlib.util.spec_from_file_location('gpu_apply',HERE/'apply_release.py')
    host=importlib.util.module_from_spec(spec);spec.loader.exec_module(host);host.validate(payload)
    return payload


def main():
    payload=payload_from_env(os.environ)
    script=base64.b64encode((HERE/'apply_release.py').read_bytes()).decode()
    body=base64.b64encode(json.dumps(payload).encode()).decode()
    commands=['set -eu','umask 077','mkdir -p /opt/orot-inference',
              'printf %s '+shlex.quote(script)+' | base64 -d > /opt/orot-inference/apply_release.py',
              'printf %s '+shlex.quote(body)+' | base64 -d | python3 /opt/orot-inference/apply_release.py']
    instance=os.environ['GPU_INSTANCE_ID']
    sent=aws('ssm','send-command',body={'InstanceIds':[instance],'DocumentName':'AWS-RunShellScript',
        'TimeoutSeconds':600,'Parameters':{'commands':commands,'executionTimeout':['3900']}})
    command_id=sent['Command']['CommandId'];deadline=time.monotonic()+4200
    while time.monotonic()<deadline:
        import subprocess
        try:result=aws('ssm','get-command-invocation','--command-id',command_id,'--instance-id',instance)
        except subprocess.CalledProcessError as e:
            if 'InvocationDoesNotExist' in e.stderr:time.sleep(5);continue
            raise
        if result['Status']=='Success':
            print(result['StandardOutputContent']);return
        if result['Status'] not in ['Pending','InProgress','Delayed']:
            raise RuntimeError('GPU release failed; inspect SSM command '+command_id+' and CloudWatch inference logs')
        time.sleep(10)
    raise TimeoutError('GPU deployment deadline exceeded; the independent boot timer still limits running time')


if __name__=='__main__':main()
