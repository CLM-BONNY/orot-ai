import importlib.util
from pathlib import Path
import pytest

spec=importlib.util.spec_from_file_location('inference_launch',Path(__file__).with_name('launch.py'))
launch=importlib.util.module_from_spec(spec);spec.loader.exec_module(launch)
BASE={'MODEL_REPO':'example/model','MODEL_REVISION':'a'*40,'MODEL_NAME':'study-model','VLLM_API_KEY':'test-only-key'}

def test_explicit_checkpoint_and_no_secret_in_command_line():
    args=launch.command(BASE)
    assert args[:3]==['vllm','serve','example/model']
    assert 'a'*40 in args and 'test-only-key' not in args

@pytest.mark.parametrize('change',[{'MODEL_REPO':''},{'MODEL_REVISION':'main'},{'MODEL_NAME':''},{'VLLM_API_KEY':''},{'MAX_MODEL_LEN':'0'},{'GPU_MEMORY_UTILIZATION':'1'}])
def test_missing_or_invalid_deployment_inputs_fail(change):
    with pytest.raises(ValueError):launch.command({**BASE,**change})


def test_qwen_text_baseline_and_file_token_are_not_exposed(tmp_path):
    path=tmp_path/'token';path.write_text('private-test-only-token')
    env={**BASE,'VLLM_API_KEY_FILE':str(path)};env.pop('VLLM_API_KEY')
    args=launch.command(env)
    assert '--language-model-only' in args and '--enforce-eager' in args
    assert '{"enable_thinking":false}' in args
    assert args[args.index('--tokenizer-revision')+1]==BASE['MODEL_REVISION']
    assert '--disable-log-requests' in args
    assert 'private-test-only-token' not in ' '.join(args) and str(path) not in args


@pytest.mark.parametrize('change',[{'MAX_NUM_SEQS':'0'},{'MAX_NUM_SEQS':'100'},{'ENFORCE_EAGER':'maybe'}])
def test_invalid_gpu_capacity_options_fail(change):
    with pytest.raises(ValueError):launch.command({**BASE,**change})
