#!/usr/bin/env python3
"""Direct Synology Download Station API E2E test.
Tests auth, API discovery, task CRUD, and statistics against a live NAS.

Usage:
  SYNO_BASE_URL=http://192.168.1.175:5000 SYNO_ACCOUNT=khoa SYNO_PASS=... python3 test/e2e-download-station-core.py

Credentials are provided via environment variables only and are not stored in the repo.
"""

import os
import json
import sys
import uuid
from urllib.request import Request, urlopen
from urllib.parse import urlencode
from urllib.error import HTTPError
import ssl

BASE_URL = os.environ.get("SYNO_BASE_URL", "").rstrip("/")
ACCOUNT = os.environ.get("SYNO_ACCOUNT", "")
PASSWORD = os.environ.get("SYNO_PASS", "")

TEST_PREFIX = f"n8n-e2e-ds-{uuid.uuid4().hex[:8]}"

failures = 0

def fail(msg):
    global failures
    failures += 1
    print(f"  ❌ FAIL: {msg}")

def ok(msg):
    print(f"  ✅ {msg}")

def api_request(path, params, json_response=True):
    """Send a POST request to the Synology WebAPI."""
    url = f"{BASE_URL}/webapi/{path.lstrip('/')}"
    body = urlencode(params).encode("utf-8")
    req = Request(url, data=body, headers={"Content-Type": "application/x-www-form-urlencoded"})
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        with urlopen(req, context=ctx, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if json_response else raw
    except HTTPError as e:
        body = e.read().decode("utf-8")
        return json.loads(body) if json_response else body

def main():
    global failures

    if not BASE_URL or not ACCOUNT or not PASSWORD:
        print("❌ Missing environment variables: SYNO_BASE_URL, SYNO_ACCOUNT, SYNO_PASS")
        sys.exit(1)

    print(f"🧪 Synology Download Station Direct API E2E")
    print(f"   NAS: {BASE_URL}")
    print(f"   Test prefix: {TEST_PREFIX}")

    # 1. Login
    print("\n📡 1. Login (SYNO.API.Auth v7, session=DownloadStation)...")
    login_resp = api_request("entry.cgi", {
        "api": "SYNO.API.Auth",
        "version": "7",
        "method": "login",
        "account": ACCOUNT,
        "passwd": PASSWORD,
        "session": "DownloadStation",
        "format": "sid",
    })
    if not login_resp.get("success"):
        fail(f"Login failed: {login_resp.get('error')}")
        sys.exit(1)
    sid = login_resp["data"]["sid"]
    ok(f"Login OK, sid={sid[:8]}...")

    # 2. API Discovery
    print("\n📡 2. API Discovery (SYNO.API.Info)...")
    info_resp = api_request("query.cgi", {
        "api": "SYNO.API.Info",
        "version": "1",
        "method": "query",
        "query": "SYNO.DownloadStation.Task,SYNO.DownloadStation2.Task,SYNO.DownloadStation.Info,SYNO.DownloadStation.Statistic",
    })
    if info_resp.get("success"):
        data = info_resp.get("data", {})
        for k, v in sorted(data.items()):
            ok(f"  {k}: path={v.get('path')}, min={v.get('minVersion')}, max={v.get('maxVersion')}")
    else:
        fail(f"API Info query failed: {info_resp.get('error')}")

    # 3. Get Statistics
    print("\n📡 3. Statistics (SYNO.DownloadStation.Statistic v1)...")
    stat_resp = api_request("DownloadStation/statistic.cgi", {
        "api": "SYNO.DownloadStation.Statistic",
        "version": "1",
        "method": "getinfo",
        "_sid": sid,
    })
    if stat_resp.get("success"):
        d = stat_resp.get("data", {})
        ok(f"speed_download={d.get('speed_download')}, speed_upload={d.get('speed_upload')}")
    else:
        fail(f"Statistics failed: {stat_resp.get('error')}")

    # 4. Create a URL task
    print("\n📡 4. Create URL Task (SYNO.DownloadStation.Task v3)...")
    test_url = "https://httpbin.org/bytes/1024"
    create_resp = api_request("DownloadStation/task.cgi", {
        "api": "SYNO.DownloadStation.Task",
        "version": "3",
        "method": "create",
        "uri": test_url,
        "_sid": sid,
    })
    task_id = None
    if create_resp.get("success"):
        task_id = create_resp.get("data", {}).get("task_id") or create_resp.get("data", {}).get("id")
        if not task_id and isinstance(create_resp.get("data"), list):
            task_id = create_resp["data"][0].get("id") if create_resp["data"] else None
        ok(f"Task created: id={task_id}")
    else:
        fail(f"V1 create failed: {create_resp.get('error')}")

    if not task_id:
        # 5. Try V2 create
        print("\n📡 5. Try V2 Create (SYNO.DownloadStation2.Task v2)...")
        v2_resp = api_request("DownloadStation/entry.cgi", {
            "api": "SYNO.DownloadStation2.Task",
            "version": "2",
            "method": "create",
            "type": "url",
            "url": test_url,
            "_sid": sid,
        })
        if v2_resp.get("success"):
            task_id = v2_resp.get("data", {}).get("task_id") or v2_resp.get("data", {}).get("id")
            if isinstance(v2_resp.get("data"), list) and v2_resp["data"]:
                task_id = v2_resp["data"][0].get("id")
            ok(f"V2 Task created: id={task_id}")
        else:
            fail(f"V2 create also failed: {v2_resp.get('error')}")

    if task_id:
        # 6. List tasks
        print("\n📡 6. List Tasks...")
        list_resp = api_request("DownloadStation/task.cgi", {
            "api": "SYNO.DownloadStation.Task",
            "version": "3",
            "method": "list",
            "_sid": sid,
        })
        if list_resp.get("success"):
            tasks = list_resp.get("data", {}).get("tasks", [])
            ok(f"Found {len(tasks)} tasks")
        else:
            fail(f"List failed: {list_resp.get('error')}")

        # 7. Get task info
        print("\n📡 7. Get Task...")
        get_resp = api_request("DownloadStation/task.cgi", {
            "api": "SYNO.DownloadStation.Task",
            "version": "3",
            "method": "getinfo",
            "id": task_id,
            "additional": "detail,transfer",
            "_sid": sid,
        })
        if get_resp.get("success"):
            tasks = get_resp.get("data", {}).get("tasks", [])
            if tasks:
                t = tasks[0]
                ok(f"Task: title={t.get('title')}, status={t.get('status')}, size={t.get('size')}")
            else:
                ok("Get returned empty tasks list")
        else:
            fail(f"Get failed: {get_resp.get('error')}")

        # 8. Pause task
        print("\n📡 8. Pause Task...")
        pause_resp = api_request("DownloadStation/task.cgi", {
            "api": "SYNO.DownloadStation.Task",
            "version": "3",
            "method": "pause",
            "id": task_id,
            "_sid": sid,
        })
        if pause_resp.get("success"):
            ok(f"Paused task: {pause_resp.get('data')}")
        else:
            fail(f"Pause failed: {pause_resp.get('error')}")

        # 9. Resume task
        print("\n📡 9. Resume Task...")
        resume_resp = api_request("DownloadStation/task.cgi", {
            "api": "SYNO.DownloadStation.Task",
            "version": "3",
            "method": "resume",
            "id": task_id,
            "_sid": sid,
        })
        if resume_resp.get("success"):
            ok(f"Resumed task: {resume_resp.get('data')}")
        else:
            fail(f"Resume failed: {resume_resp.get('error')}")

        # 10. Delete task
        print("\n📡 10. Delete Task...")
        delete_resp = api_request("DownloadStation/task.cgi", {
            "api": "SYNO.DownloadStation.Task",
            "version": "3",
            "method": "delete",
            "id": task_id,
            "_sid": sid,
        })
        if delete_resp.get("success"):
            ok(f"Deleted task: {delete_resp.get('data')}")
        else:
            fail(f"Delete failed: {delete_resp.get('error')}")
    else:
        print("\n  ⚠️  Skipping task operations (no task_id).")

    # 11. Logout
    print("\n📡 11. Logout...")
    logout_resp = api_request("entry.cgi", {
        "api": "SYNO.API.Auth",
        "version": "7",
        "method": "logout",
        "session": "DownloadStation",
    })
    if logout_resp.get("success"):
        ok("Logout OK")
    else:
        fail(f"Logout failed: {logout_resp.get('error')}")

    print(f"\n{'='*50}")
    if failures:
        print(f"❌ {failures} test(s) failed")
        sys.exit(1)
    else:
        print("✅ All tests passed")
        sys.exit(0)

if __name__ == "__main__":
    main()
