import importlib.util
from pathlib import Path
import sys
from copy import deepcopy
import pytest
here=Path(__file__).parent
spec=importlib.util.spec_from_file_location('ssm_helper',here/'deploy.py');helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
previous=sys.modules.get('deploy');sys.modules['deploy']=helper
spec=importlib.util.spec_from_file_location('gpu_session',here/'gpu_session.py');gpu=importlib.util.module_from_spec(spec);spec.loader.exec_module(gpu)
if previous is None:del sys.modules['deploy']
else:sys.modules['deploy']=previous
INSTANCE={'State':{'Name':'stopped'},'Tags':[{'Key':'Project','Value':'orot-ai'},{'Key':'Role','Value':'inference'}]}
def setup(monkeypatch,instance=None):
    calls=[]
    def aws(*args,**kwargs):
        calls.append(args)
        if args[1]=='describe-instances':return {'Reservations':[{'Instances':[deepcopy(instance or INSTANCE)]}]}
        if args[1]=='describe-instance-attribute':return {'InstanceInitiatedShutdownBehavior':{'Value':'stop'}}
        return {}
    monkeypatch.setattr(gpu,'aws',aws)
    monkeypatch.setattr(gpu.subprocess,'run',lambda *a,**kw:None)
    return calls

def test_schedules_shutdown_after_start(monkeypatch):
    calls=setup(monkeypatch);commands=[]
    monkeypatch.setattr(sys,'argv',['gpu_session.py','start','--instance-id','i-fixture','--minutes','45'])
    monkeypatch.setattr(gpu,'execute',lambda instance,cmd:commands.extend(cmd));gpu.main()
    assert any(c[1]=='start-instances' for c in calls) and commands==['shutdown -h +45']

def test_failed_guard_setup_stops_the_gpu(monkeypatch):
    calls=setup(monkeypatch)
    monkeypatch.setattr(sys,'argv',['gpu_session.py','start','--instance-id','i-fixture'])
    def failed(*args):raise RuntimeError('SSM unavailable')
    monkeypatch.setattr(gpu,'execute',failed)
    with pytest.raises(RuntimeError):gpu.main()
    assert calls[-1][1]=='stop-instances'

@pytest.mark.parametrize('minutes',['0','181'])
def test_invalid_session_never_touches_aws(monkeypatch,minutes):
    calls=setup(monkeypatch)
    monkeypatch.setattr(sys,'argv',['gpu_session.py','start','--instance-id','i-fixture','--minutes',minutes])
    with pytest.raises(ValueError):gpu.main()
    assert not calls

def test_refuses_to_start_or_stop_an_unrelated_instance(monkeypatch):
    calls=setup(monkeypatch,{'State':{'Name':'stopped'},'Tags':[]})
    monkeypatch.setattr(sys,'argv',['gpu_session.py','stop','--instance-id','i-unrelated'])
    with pytest.raises(ValueError):gpu.main()
    assert [c[1] for c in calls]==['describe-instances']
