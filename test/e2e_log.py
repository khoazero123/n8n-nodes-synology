"""Quiet E2E logging for Python direct API tests (no user payload dumps in CI)."""
from __future__ import annotations

import json
import os
import re


def quiet() -> bool:
    if os.environ.get('SYNO_E2E_VERBOSE') == 'true':
        return False
    if os.environ.get('SYNO_E2E_QUIET') == 'true':
        return True
    return os.environ.get('CI') == 'true' or os.environ.get('GITHUB_ACTIONS') == 'true'


def redact(text: str) -> str:
    text = re.sub(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', '[email]', text)
    text = re.sub(r'\b(token|password|passwd|_sid|sid)=[^\s&"\']+', r'\1=[redacted]', text, flags=re.I)
    text = re.sub(r'https?://[^\s"\']+', '[url]', text)
    return text


def show(name: str, obj) -> None:
    if quiet():
        if isinstance(obj, dict) and obj.get('success') is False:
            print(f'❌ {name}')
        elif isinstance(obj, bytes):
            print(f'✅ {name}')
        else:
            print(f'✅ {name}')
        return
    text = json.dumps(obj, ensure_ascii=False) if not isinstance(obj, bytes) else f'<bytes {len(obj)}>'
    if len(text) > 900:
        text = text[:900] + '...<truncated>'
    print(f'{name}: {text}')


def ok(name: str) -> None:
    print(f'✅ {name}')


def fail_line(name: str, err: str = '') -> None:
    tail = redact(err)[:220] if err else ''
    print(f'❌ {name}{": " + tail if tail else ""}')


def step(msg: str) -> None:
    if not quiet():
        print(msg)
