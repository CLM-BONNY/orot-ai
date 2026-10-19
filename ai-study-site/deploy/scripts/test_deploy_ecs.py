from copy import deepcopy
import importlib.util
from pathlib import Path
import pytest
spec=importlib.util.spec_from_file_location('deploy_ecs',Path(__file__).with_name('deploy_ecs.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
TASK={'family':'orot-app','taskDefinitionArn':'old-arn','status':'ACTIVE','revision':1,'networkMode':'awsvpc',
      'containerDefinitions':[{'name':'web','image':'old-web'},{'name':'api','image':'old-api','environment':[{'name':'MODEL_NAME','value':'study-model'},{'name':'APP_REVISION','value':'old'}]}]}

def test_updates_both_images_preserves_runtime_settings_and_removes_read_only_fields():
    before=deepcopy(TASK);digest='registry/app@sha256:'+'a'*64
    result=module.render_task(TASK,{'web':digest,'api':digest},'commit-sha')
    assert TASK==before and 'taskDefinitionArn' not in result and 'revision' not in result
    assert all(c['image']==digest for c in result['containerDefinitions'])
    assert {'name':'MODEL_NAME','value':'study-model'} in result['containerDefinitions'][1]['environment']
    assert sum(e['name']=='APP_REVISION' for e in result['containerDefinitions'][1]['environment'])==1

@pytest.mark.parametrize('images',[{}, {'missing':'repo@sha256:'+'a'*64},{'web':'repo:latest'}])
def test_invalid_deployment_never_renders(images):
    with pytest.raises(ValueError):module.render_task(TASK,images,'sha')
