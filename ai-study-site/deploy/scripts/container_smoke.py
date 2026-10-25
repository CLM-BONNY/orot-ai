"""Non-inference smoke check for the real web/API containers."""
import argparse
import json
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import sys
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from verify_local import verify


def smoke(base, expect_ai_disabled=False):
    report = verify(base)
    with urlopen(base + '/healthz',timeout=5) as r:
        assert r.status==200 and r.read().strip()==b'ok'
    with urlopen(base + '/api/meta',timeout=10) as r:
        meta=json.load(r)
        release=meta['content_release_id']
    body={'kind':'tutor_request','request_id':'REQ-00000000-0000-4000-8000-000000000001',
          'content_release_id':release,'page_id':'CH99-P99','message':'invalid page test','history':[]}
    try:
        urlopen(Request(base+'/api/ai/tutor',data=json.dumps(body).encode(),headers={'Content-Type':'application/json'}),timeout=10)
        raise AssertionError('Invalid page must be rejected before inference')
    except HTTPError as e:
        assert e.code==404 and json.load(e)['error']['code']=='UNKNOWN_PAGE'
    if expect_ai_disabled:
        assert meta['provider']=='disabled' and meta['model_ready'] is False
        body['page_id']='CH01-P01';body['message']='현재 페이지를 설명해 주세요.'
        try:
            urlopen(Request(base+'/api/ai/tutor',data=json.dumps(body).encode(),headers={'Content-Type':'application/json'}),timeout=5)
            raise AssertionError('Disabled AI must not generate a response')
        except HTTPError as e:
            assert e.code==503 and json.load(e)['error']['code']=='MODEL_DISABLED'
        report['checks'].append('Web-only mode returns MODEL_DISABLED through Nginx while content remains available')
    report['checks'].extend(['Nginx health endpoint','JSON AI error passes through reverse proxy without calling a model'])
    print(json.dumps(report,ensure_ascii=False,indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:5180')
    parser.add_argument('--expect-ai-disabled',action='store_true')
    args=parser.parse_args()
    smoke(args.url.rstrip('/'),args.expect_ai_disabled)
