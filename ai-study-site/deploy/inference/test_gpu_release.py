from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import pytest

spec=importlib.util.spec_from_file_location('gpu_host',Path(__file__).with_name('apply_release.py'))
host=importlib.util.module_from_spec(spec);spec.loader.exec_module(host)
RID='a'*40+'-123-1'
BASE={'release_id':RID,'secret_arn':'fixture-arn','compose':'fixture',
      'env':{'INFERENCE_IMAGE':'123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/orot-ai-inference@sha256:'+'b'*64,
             'MODEL_REPO':'Qwen/Qwen3.5-9B','MODEL_REVISION':'c'*40,'MODEL_NAME':'fixture-model',
             'PRIVATE_IPV4':'10.42.1.100','SECRETS_DIR':'/opt/orot-inference/releases/'+RID+'/secrets'}}


@pytest.mark.parametrize('key,value',[('PRIVATE_IPV4','8.8.8.8'),('PRIVATE_IPV4','127.0.0.1'),
    ('INFERENCE_IMAGE','vllm/vllm-openai:latest'),('MODEL_REVISION','main'),
    ('SECRETS_DIR','/tmp/secrets'),('MODEL_REPO','x/../../model')])
def test_gpu_rollout_rejects_unsafe_or_unreproducible_inputs(key,value):
    p=deepcopy(BASE);p['env'][key]=value
    with pytest.raises(ValueError):host.validate(p)


def test_gpu_host_requires_its_guard_before_reading_any_secret(monkeypatch):
    calls=[]
    def run(args,**kwargs):
        calls.append(args)
        raise RuntimeError('not a guarded GPU')
    monkeypatch.setattr(host,'run',run)
    with pytest.raises(RuntimeError):host.apply(BASE)
    assert calls==[['systemctl','is-active','orot-gpu-stop.timer']]


def test_authenticated_readiness_checks_the_served_model_without_logging_token(monkeypatch,capsys):
    class Response:
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def read(self):return json.dumps({'data':[{'id':'fixture-model'}]}).encode()
    def open_request(request,**kwargs):
        assert request.full_url=='http://127.0.0.1:8000/v1/models'
        assert request.headers['Authorization']=='Bearer fixture-private-token'
        return Response()
    monkeypatch.setattr(host,'urlopen',open_request)
    host.wait_ready('fixture-model','fixture-private-token',seconds=1)
    assert 'fixture-private-token' not in capsys.readouterr().out
