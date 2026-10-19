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
