import importlib.util
from pathlib import Path
from copy import deepcopy
import pytest
spec=importlib.util.spec_from_file_location('apply_release',Path(__file__).with_name('apply_release.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
REV='a'*40
BASE={'revision':REV,'release_id':REV+'-123-1','env':{'API_IMAGE':'123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/orot-ai-api@sha256:'+'b'*64,
 'WEB_IMAGE':'123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/orot-ai-web@sha256:'+'c'*64,'APP_REVISION':REV,
 'APP_DOMAIN':'orot-ai-study.com','AWS_REGION':'ap-northeast-2','INFERENCE_BASE_URL':'http://10.42.1.10:8000/v1',
 'MODEL_NAME':'orot-tutor','SECRETS_DIR':'/opt/orot/releases/'+REV+'-123-1/secrets'}}

def test_immutable_private_release_inputs():assert module.validate(BASE)==BASE
@pytest.mark.parametrize('key,value',[('API_IMAGE','repo:latest'),('APP_REVISION','other'),('APP_DOMAIN','https://example.com'),('MODEL_NAME','value\nINJECTED=x'),('INFERENCE_BASE_URL','http://10.example.com:8000/v1'),('INFERENCE_BASE_URL','http://8.8.8.8:8000/v1'),('INFERENCE_BASE_URL','http://10.42.1.10:80/v1'),('SECRETS_DIR','/tmp/elsewhere')])
def test_invalid_inputs_fail_before_any_remote_action(key,value):
    p=deepcopy(BASE);p['env'][key]=value
    with pytest.raises(ValueError):module.validate(p)

def test_release_path_cannot_escape_root():
    p=deepcopy(BASE);p['release_id']='../escape'
    with pytest.raises(ValueError):module.validate(p)

def test_api_reads_token_file_without_exposing_it(monkeypatch,tmp_path):
    from backend.config import inference_token
    path=tmp_path/'token';path.write_text('fixture-key\n')
    monkeypatch.setenv('INFERENCE_AUTH_TOKEN_FILE',str(path))
    monkeypatch.setenv('INFERENCE_AUTH_TOKEN','wrong-fallback')
    assert inference_token()=='fixture-key'


def _host(monkeypatch,tmp_path):
    from types import SimpleNamespace
    root=tmp_path/'orot';root.mkdir()
    monkeypatch.setattr(module,'ROOT',root)
    monkeypatch.setattr(module,'run',lambda args:'fixture-private-value')
    monkeypatch.setattr(module.subprocess,'run',lambda *a,**kw:SimpleNamespace(returncode=0))
    p=deepcopy(BASE);p['files']={'compose.yml':'fixture-compose','Caddyfile':'fixture-caddy'}
    p['secrets']={'inference_token':'fixture-arn','site_login':'fixture-login-arn'}
    return root,p


def test_successful_host_release_keeps_secret_out_of_stdout_and_old_release(monkeypatch,tmp_path,capsys):
    root,p=_host(monkeypatch,tmp_path)
    old=root/'releases'/'old';old.mkdir(parents=True);(old/'release.json').write_text('{"revision":"old"}')
    (root/'current').symlink_to(old)
    monkeypatch.setattr(module,'activate',lambda *args:None)
    module.apply(p)
    assert (root/'current').resolve().name==p['release_id']
    assert (root/'previous').resolve()==old
    assert 'fixture-private-value' not in capsys.readouterr().out
    assert ((root/'current').resolve()/'secrets').stat().st_mode & 0o777==0o700


def test_host_activation_failure_restores_previous_release(monkeypatch,tmp_path):
    root,p=_host(monkeypatch,tmp_path)
    old=root/'releases'/'old';old.mkdir(parents=True);(old/'release.json').write_text('{"revision":"old"}')
    (root/'current').symlink_to(old)
    calls=[]
    def activate(folder,revision):
        calls.append(revision)
        if revision==REV:raise RuntimeError('fixture startup failure')
    monkeypatch.setattr(module,'activate',activate)
    with pytest.raises(RuntimeError):module.apply(p)
    assert calls==[REV,'old']
    assert (root/'current').resolve()==old


def test_public_failure_can_roll_back_an_already_activated_release(monkeypatch,tmp_path,capsys):
    root,p=_host(monkeypatch,tmp_path)
    old=root/'releases'/'old';old.mkdir(parents=True);(old/'release.json').write_text('{"revision":"old"}')
    (root/'previous').symlink_to(old)
    current=root/'releases'/'bad';current.mkdir();(root/'current').symlink_to(current)
    calls=[];monkeypatch.setattr(module,'activate',lambda folder,rev:calls.append(rev))
    module.rollback()
    assert calls==['old'] and (root/'current').resolve()==old
