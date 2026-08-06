#!/usr/bin/env python3
"""Direct Synology Download Station API E2E test.
Tests auth, API discovery, task CRUD, and statistics against a live NAS.

Usage:
  SYNO_BASE_URL=http://192.168.1.175:5000 SYNO_ACCOUNT=khoa SYNO_PASS=... python3 test/e2e-download-station-core.py
  ALLOW_DESTRUCTIVE_DS_E2E=1 SYNO_BASE_URL=... SYNO_ACCOUNT=... SYNO_PASS=... python3 test/e2e-download-station-core.py

Credentials are provided via environment variables only and are not stored in the repo.
Task creation/pause/resume/deletion is opt-in via ALLOW_DESTRUCTIVE_DS_E2E=1; the default run is read-only.
"""

import os
import json
import sys
import uuid
from urllib.request import Request, urlopen
from urllib.parse import urlencode
from urllib.error import HTTPError
import ssl
import time

BASE_URL = os.environ.get("SYNO_BASE_URL", "").rstrip("/")
ACCOUNT = os.environ.get("SYNO_ACCOUNT", "")
PASSWORD = os.environ.get("SYNO_PASS", "")

TEST_PREFIX = f"n8n-e2e-ds-{uuid.uuid4().hex[:8]}"
ALLOW_DESTRUCTIVE = os.environ.get("ALLOW_DESTRUCTIVE_DS_E2E") == "1"

failures = 0

def fail(msg):
    global failures
    failures += 1
    print(f"  ❌ FAIL: {msg}")

def ok(msg):
    print(f"  ✅ {msg}")

def api_request(path, params, json_response=True, headers=None):
    """Send a POST request to the Synology WebAPI."""
    url = f"{BASE_URL}/webapi/{path.lstrip('/')}"
    body = urlencode(params).encode("utf-8")
    req_headers = {"Content-Type": "application/x-www-form-urlencoded"}
    if headers:
        req_headers.update(headers)
    req = Request(url, data=body, headers=req_headers)
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
        "query": "SYNO.DownloadStation.Task,SYNO.DownloadStation2.Task,SYNO.DownloadStation.Info,SYNO.DownloadStation.Statistic,SYNO.DownloadStation.BTSearch,SYNO.DownloadStation.Schedule",
    })
    if info_resp.get("success"):
        data = info_resp.get("data", {})
        for k, v in sorted(data.items()):
            ok(f"  {k}: path={v.get('path')}, min={v.get('minVersion')}, max={v.get('maxVersion')}")
    else:
        fail(f"API Info query failed: {info_resp.get('error')}")

    # 3. Get Download Station info
    print("\n📡 3. Info (SYNO.DownloadStation.Info v2 getinfo, read-only)...")
    info_get_resp = api_request("DownloadStation/info.cgi", {
        "api": "SYNO.DownloadStation.Info",
        "version": "2",
        "method": "getinfo",
        "_sid": sid,
    })
    if info_get_resp.get("success"):
        info_data = info_get_resp.get("data", {})
        if "version" in info_data or "version_string" in info_data:
            ok(f"version={info_data.get('version')}, version_string={info_data.get('version_string')}")
        else:
            fail(f"Info returned unexpected shape: {info_data}")
    else:
        fail(f"Info getinfo failed: {info_get_resp.get('error')}")

    # 4. Get Download Station config
    print("\n📡 4. Config (SYNO.DownloadStation.Info v2 getconfig, read-only)...")
    config_resp = api_request("DownloadStation/info.cgi", {
        "api": "SYNO.DownloadStation.Info",
        "version": "2",
        "method": "getconfig",
        "_sid": sid,
    })
    if config_resp.get("success"):
        config_data = config_resp.get("data", {})
        config_keys = {"bt_max_download", "bt_max_upload", "default_destination", "emule_enabled"}
        if any(key in config_data for key in config_keys):
            ok(f"default_destination={config_data.get('default_destination')}")
        else:
            fail(f"Config returned unexpected shape: {config_data}")
    else:
        fail(f"Info getconfig failed: {config_resp.get('error')}")

    # 5. Get Statistics
    print("\n📡 5. Statistics (SYNO.DownloadStation.Statistic v1)...")
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

    # 6. List tasks (safe read-only check)
    print("\n📡 6. List Tasks (read-only)...")
    list_resp = api_request("DownloadStation/task.cgi", {
        "api": "SYNO.DownloadStation.Task",
        "version": "3",
        "method": "list",
        "_sid": sid,
    })
    if list_resp.get("success"):
        ok(f"Found {len(list_resp.get('data', {}).get('tasks', []))} tasks")
    else:
        fail(f"List failed: {list_resp.get('error')}")

    task_id = None

    # 7. BT search (safe read-only check)
    print("\n📡 7. BT Search (SYNO.DownloadStation.BTSearch v1, read-only)...")
    bt_resp = api_request("DownloadStation/btsearch.cgi", {
        "api": "SYNO.DownloadStation.BTSearch",
        "version": "1",
        "method": "list",
        "keyword": "ubuntu",
        "limit": "5",
        "_sid": sid,
    })
    if bt_resp.get("success"):
        bt_data = bt_resp.get("data", {})
        if isinstance(bt_data.get("items"), list) and isinstance(bt_data.get("total"), int):
            ok(f"BT search total={bt_data.get('total')}, offset={bt_data.get('offset')}")
        else:
            fail(f"BT search returned unexpected shape: {bt_data}")
    else:
        fail(f"BT search failed: {bt_resp.get('error')}")

    if ALLOW_DESTRUCTIVE:
        # 8b. V2 torrent upload via frontend contract (cookie auth + X-SYNO-TOKEN).
        # Verified 2026-08-06: needs `enable_syno_token=yes` login, Cookie: id=<sid>
        # header + X-SYNO-TOKEN, multipart fields in exact frontend order, and
        # binary-safe CRLF construction (a bytes repr bug corrupts the body).
        print("\n📡 8b. V2 Torrent Upload (SYNO.DownloadStation2.Task v2, cookie auth)...")
        import uuid as _uuid, time as _time
        torrent_created = False
        torrent_path = os.environ.get("SYNO_TORRENT_PATH", "")
        if torrent_path and os.path.isfile(torrent_path):
            # login with syno token to get X-SYNO-TOKEN
            lr2 = api_request("entry.cgi", {
                "api": "SYNO.API.Auth", "version": "7", "method": "login",
                "account": ACCOUNT, "passwd": PASSWORD,
                "session": "DownloadStation", "format": "sid",
                "enable_syno_token": "yes",
            })
            if lr2.get("success"):
                sid2 = lr2["data"]["sid"]
                token = lr2["data"].get("synotoken", "")
                with open(torrent_path, "rb") as f:
                    tdata = f.read()
                boundary = "----n8nE2E" + _uuid.uuid4().hex[:16]
                crlf = b"\r\n"
                body_parts = []
                fields = [
                    ("api", "SYNO.DownloadStation2.Task"),
                    ("method", "create"),
                    ("version", "2"),
                    ("type", '"file"'),
                    ("file", '["torrent"]'),
                    ("destination", json.dumps("home/Drive/Download")),
                    ("create_list", "false"),
                    ("mtime", str(int(_time.time() * 1000))),
                    ("size", str(len(tdata))),
                ]
                for name, val in fields:
                    body_parts.append(b"--" + boundary.encode() + crlf)
                    body_parts.append(('Content-Disposition: form-data; name="%s"' % name).encode() + crlf + crlf)
                    body_parts.append(val.encode() + crlf)
                body_parts.append(b"--" + boundary.encode() + crlf)
                body_parts.append(b'Content-Disposition: form-data; name="torrent"; filename="e2e.torrent"' + crlf)
                body_parts.append(b"Content-Type: application/x-bittorrent" + crlf + crlf)
                body_parts.append(tdata)
                body_parts.append(crlf + b"--" + boundary.encode() + b"--" + crlf)
                mbody = b"".join(body_parts)
                url = f"{BASE_URL}/webapi/entry.cgi/SYNO.DownloadStation2.Task"
                req = Request(url, data=mbody, headers={
                    "Content-Type": f"multipart/form-data; boundary={boundary}",
                    "Cookie": f"id={sid2}",
                    "X-SYNO-TOKEN": token,
                }, method="POST")
                ctx2 = ssl.create_default_context()
                ctx2.check_hostname = False
                ctx2.verify_mode = ssl.CERT_NONE
                try:
                    with urlopen(req, context=ctx2, timeout=60) as resp:
                        tresp = json.loads(resp.read().decode())
                    if tresp.get("success"):
                        tid = tresp.get("data", {}).get("task_id") or []
                        if tid:
                            ok(f"Torrent task created: {tid[0]}")
                            task_id = tid[0]
                            torrent_created = True
                        else:
                            ok("Torrent upload accepted (list flow)")
                    else:
                        fail(f"Torrent upload failed: {tresp.get('error')}")
                except HTTPError as e:
                    fail(f"Torrent upload HTTP error: {e.read().decode()[:200]}")
            else:
                fail("Login with syno token failed")
        else:
            print("  ⏭️  Skipping torrent upload (set SYNO_TORRENT_PATH to a .torrent file)")

        if task_id and torrent_created:
            del_t = api_request("DownloadStation/entry.cgi", {
                "api": "SYNO.DownloadStation2.Task", "version": "2",
                "method": "delete", "id": json.dumps([task_id]),
            }, headers={"Cookie": f"id={sid2}", "X-SYNO-TOKEN": token})
            print(f"  🧹 Torrent task cleanup: {del_t.get('success')}")
            task_id = None

        # 8. Create a URL task. This creates a real NAS task and is opt-in.
        print("\n📡 8. Create URL Task (SYNO.DownloadStation.Task v3)...")
        test_url = "https://httpbin.org/bytes/1024"
        create_resp = api_request("DownloadStation/task.cgi", {
            "api": "SYNO.DownloadStation.Task",
            "version": "3",
            "method": "create",
            "uri": test_url,
            "_sid": sid,
        })
        if create_resp.get("success"):
            d = create_resp.get("data")
            task_id = None
            if isinstance(d, dict):
                task_id = d.get("task_id") or d.get("id")
            elif isinstance(d, list) and d:
                task_id = d[0].get("id")
            if not task_id:
                # V1 create may return {"success": true} without data; find via list
                time.sleep(2)
                after = api_request("DownloadStation/task.cgi", {
                    "api": "SYNO.DownloadStation.Task", "version": "3", "method": "list", "_sid": sid,
                })
                tasks = after.get("data", {}).get("tasks", [])
                if tasks:
                    task_id = tasks[-1].get("id")
            ok(f"Task created: id={task_id}")
        else:
            print(f"  ⚠️  V1 create failed: {create_resp.get('error')}; trying undocumented V2")

        if not task_id:
            # 6. Try V2 create only in the explicitly enabled destructive test.
            print("\n📡 6. Try V2 Create (SYNO.DownloadStation2.Task v2, URL)...")
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
    else:
        print("\n⏭️  Skipping create/pause/resume/delete (set ALLOW_DESTRUCTIVE_DS_E2E=1 to opt in).")

    if task_id:
        # 7. List tasks after creation
        print("\n📡 7. List Tasks after creation...")
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

        # 8. Get task info
        print("\n📡 8. Get Task...")
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

        # 9. Pause task
        print("\n📡 9. Pause Task...")
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

        # 10. Resume task
        print("\n📡 10. Resume Task...")
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

        # 11. Delete task
        print("\n📡 11. Delete Task...")
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
