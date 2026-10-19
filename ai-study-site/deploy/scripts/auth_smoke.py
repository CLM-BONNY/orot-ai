"""CI-only fixture authentication checks; does not use real deployment secrets."""
import base64
import json
from urllib.error import HTTPError
from urllib.request import Request,urlopen

BASE='http://127.0.0.1:5180'
for path in ['/notebook','/api/meta']:
    try:
        urlopen(BASE+path,timeout=10)
        raise AssertionError('Expected authentication challenge')
    except HTTPError as e:assert e.code==401
    token=base64.b64encode(b'fixture-user:fixture-password').decode()
    with urlopen(Request(BASE+path,headers={'Authorization':'Basic '+token}),timeout=10) as r:assert r.status==200
for path in ['/healthz','/api/health','/release.json']:
    with urlopen(BASE+path,timeout=10) as r:assert r.status==200
print('Site authentication, authorized API proxy and deployment health endpoints passed')
