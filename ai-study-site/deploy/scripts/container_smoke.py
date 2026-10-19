"""Non-inference smoke check for the real web/API containers."""
import argparse
import json
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import sys
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from verify_local import verify


def smoke(base):
    report = verify(base)
    with urlopen(base + '/healthz',timeout=5) as r:
        assert r.status==200 and r.read().strip()==b'ok'
    with urlopen(base + '/api/meta',timeout=10) as r:
        release=json.load(r)['content_release_id']
    body={'kind':'tutor_request','request_id':'REQ-00000000-0000-4000-8000-000000000001',
          'content_release_id':release,'page_id':'CH99-P99','message':'invalid page test','history':[]}
    try:
        urlopen(Request(base+'/api/ai/tutor',data=json.dumps(body).encode(),headers={'Content-Type':'application/json'}),timeout=10)
        raise AssertionError('Invalid page must be rejected before inference')
    except HTTPError as e:
        assert e.code==404 and json.load(e)['error']['code']=='UNKNOWN_PAGE'
    report['checks'].extend(['Nginx health endpoint','JSON AI error passes through reverse proxy without calling a model'])
    print(json.dumps(report,ensure_ascii=False,indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:5180')
    smoke(parser.parse_args().url.rstrip('/'))
