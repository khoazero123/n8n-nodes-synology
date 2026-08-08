#!/usr/bin/env python3
"""Synology Drive REST API E2E smoke test.

Required env:
  SYNO_BASE_URL=http://192.168.1.100:5000
  SYNO_ACCOUNT=...
  SYNO_PASS=...
"""
from __future__ import annotations
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from e2e_log import quiet, show, redact

BASE_URL = os.environ['SYNO_BASE_URL'].rstrip('/')
ACCOUNT = os.environ['SYNO_ACCOUNT']
PASSWORD = os.environ['SYNO_PASS']
PREFIX = f"n8n-nodes-synology-drive-e2e-{int(time.time())}"
FOLDER = f"/mydrive/{PREFIX}"
FILE = f"{FOLDER}/hello.txt"
TEXT = f"Hello from n8n Synology Drive E2E {PREFIX}\n"

opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor())
created = []

def request(method: str, path: str, query: dict | None = None, body: dict | bytes | None = None, headers: dict | None = None) -> tuple[dict | bytes, dict]:
    url = f"{BASE_URL}{path}"
    if query:
        url += '?' + urllib.parse.urlencode(query, doseq=True)
    data = None
    hdrs = headers or {}
    if isinstance(body, dict):
        data = json.dumps(body).encode()
        hdrs = {'Content-Type': 'application/json', 'Accept': 'application/json', **hdrs}
    elif isinstance(body, bytes):
        data = body
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    with opener.open(req, timeout=30) as resp:
        raw = resp.read()
        ctype = resp.headers.get('Content-Type', '')
        if 'application/json' in ctype:
            return json.loads(raw.decode()), dict(resp.headers)
        return raw, dict(resp.headers)

def require(ok: bool, message: str) -> None:
    if not ok:
        raise RuntimeError(message)

def cleanup() -> None:
    try:
        request('POST', '/api/SynologyDrive/default/v1/files/delete', body={'permanent': True, 'files': [FOLDER]})
        if not quiet():
            print('cleanup: deleted temp folder')
    except Exception as exc:
        print(f'cleanup warning: {redact(str(exc))}', file=sys.stderr)

def main() -> int:
    login, _ = request('POST', '/api/SynologyDrive/default/v1/login', body={'format': 'sid', 'account': ACCOUNT, 'passwd': PASSWORD})
    show('login', login)
    require(isinstance(login, dict) and login.get('success') and login.get('data', {}).get('sid') and login.get('data', {}).get('did'), 'Drive login failed')
    sid = login['data']['sid']
    did = login['data']['did']
    opener.addheaders.append(('Cookie', f'id={sid}; did={did};'))

    res, _ = request('POST', '/api/SynologyDrive/default/v1/files', query={'type': 'folder', 'path': FOLDER}, body={'modified_time': int(time.time() * 1000)})
    show('create folder', res)
    require(isinstance(res, dict) and res.get('success'), 'create folder failed')

    content64 = base64.b64encode(TEXT.encode()).decode()
    res, _ = request('POST', '/api/SynologyDrive/default/v1/files', query={'type': 'file', 'path': FILE}, body={'modified_time': int(time.time() * 1000), 'file_content': content64})
    show('create file', res)
    require(isinstance(res, dict) and res.get('success'), 'create file failed')

    res, _ = request('POST', '/api/SynologyDrive/default/v1/files/list', query={'path': FOLDER, 'limit': 20, 'offset': 0, 'sort_by': 'name', 'sort_direction': 'asc'}, body={'filter': {}})
    show('list folder', res)
    require(isinstance(res, dict) and res.get('success'), 'list folder failed')
    require('hello.txt' in json.dumps(res, ensure_ascii=False), 'created file not found in list')

    res, _ = request('POST', '/api/SynologyDrive/default/v1/files/search', query={'limit': 20, 'offset': 0, 'sort_by': 'name', 'sort_direction': 'asc'}, body={'keyword': PREFIX})
    show('search', res)
    require(isinstance(res, dict) and res.get('success'), 'search failed')

    res, headers = request('POST', '/api/SynologyDrive/default/v1/files/download', body={'force_download': False, 'files': [FILE]})
    show('download', res)
    if isinstance(res, dict):
        require(False, f'download returned json error: {res}')
    require(TEXT.encode() in res, 'downloaded content mismatch')

    res, _ = request('POST', '/api/SynologyDrive/default/v1/files/delete', body={'permanent': True, 'files': [FOLDER]})
    show('delete folder', res)
    require(isinstance(res, dict) and res.get('success'), 'delete folder failed')

    if quiet():
        print(json.dumps({'success': True}))
    else:
        print(json.dumps({'success': True, 'folder': FOLDER, 'file': FILE}, ensure_ascii=False, indent=2))
    return 0

if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except urllib.error.HTTPError as exc:
        print('E2E_FAIL HTTP:', exc.code, redact(exc.read().decode(errors='replace')[:500]), file=sys.stderr)
        raise SystemExit(1)
    except Exception as exc:
        print('E2E_FAIL:', redact(str(exc)), file=sys.stderr)
        raise SystemExit(1)
    finally:
        cleanup()
