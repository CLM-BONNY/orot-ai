from pathlib import Path
from fastapi.testclient import TestClient
import pytest
from backend.app import create_app

@pytest.fixture
def client(tmp_path):
    (tmp_path / 'assets').mkdir()
    (tmp_path / 'assets/app-hash.js').write_text('console.log("test")')
    (tmp_path / 'index.html').write_text('<html>production shell</html>')
    with TestClient(create_app(frontend_dir=tmp_path)) as client:
        yield client

@pytest.mark.parametrize('path',['/','/notebook?tab=notes','/learn/CH21-P01','/curriculum','/quiz/CH01','/quiz/capstones','/review/wrong','/review/star','/review/ai?generation=GEN-test','/ai-review'])
def test_direct_routes_serve_the_spa(client,path):
    response=client.get(path)
    assert response.status_code==200
    assert 'production shell' in response.text
    assert response.headers['cache-control']=='no-cache'

@pytest.mark.parametrize('path',['/api/no-such-api','/assets/missing.js','/content/missing.json','/.env.local','/backend/config.py','/no-such-route','/assets/../.env.local'])
def test_missing_resources_never_return_spa(client,path):
    response=client.get(path)
    assert response.status_code==404
    assert 'production shell' not in response.text

def test_content_and_asset_cache_headers(client):
    assert client.get('/api/health').headers['cache-control']=='no-store'
    response=client.get('/assets/app-hash.js')
    assert 'immutable' in response.headers['cache-control']
    assert response.headers['x-content-type-options']=='nosniff'
    content=client.get('/content/curriculum.json')
    assert content.status_code==200
    assert content.headers['cache-control']=='no-cache'
    assert 'gzip' == content.headers.get('content-encoding')

def test_fails_at_startup_without_build(tmp_path):
    with pytest.raises(RuntimeError):
        create_app(frontend_dir=tmp_path)
