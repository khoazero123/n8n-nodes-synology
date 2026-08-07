#!/usr/bin/env python3
"""Synology Note Station core CRUD E2E test.

Required env:
  SYNO_BASE_URL=http://192.168.1.100:5000
  SYNO_ACCOUNT=nasadmin
  SYNO_PASS=...

This script creates temporary test data and deletes it in cleanup.
Do not hardcode credentials here.
"""
from __future__ import annotations
import json
import os
import sys
import time
import urllib.parse
import urllib.request

BASE_URL = os.environ["SYNO_BASE_URL"].rstrip("/")
ACCOUNT = os.environ["SYNO_ACCOUNT"]
PASSWORD = os.environ["SYNO_PASS"]
SESSION = "NoteStation"
PREFIX = f"n8n-nodes-synology E2E {int(time.time())}"

opener = urllib.request.build_opener()
sid: str | None = None
created_note: str | None = None
created_notebook: str | None = None


def post(params: dict) -> dict:
	data = urllib.parse.urlencode(params).encode()
	req = urllib.request.Request(f"{BASE_URL}/webapi/entry.cgi", data=data)
	with opener.open(req, timeout=30) as resp:
		return json.loads(resp.read().decode())


def sanitize(obj: dict) -> str:
	text = json.dumps(obj, ensure_ascii=False)
	return text[:800] + "...<truncated>" if len(text) > 800 else text


def api(api_name: str, version: int, method: str, **params) -> dict:
	payload = {"api": api_name, "version": str(version), "method": method, "_sid": sid}
	for key, value in params.items():
		if value is None:
			continue
		payload[key] = json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else value
	response = post(payload)
	print(f"{api_name}.{method}:", "OK" if response.get("success") else "FAIL", sanitize(response))
	return response


def require(ok: bool, message: str) -> None:
	if not ok:
		raise RuntimeError(message)


def cleanup() -> None:
	global created_note, created_notebook
	try:
		if sid and created_note:
			api("SYNO.NoteStation.Note", 3, "delete", object_id=created_note, recycle="false")
	except Exception as exc:
		print("cleanup note error:", exc, file=sys.stderr)
	try:
		if sid and created_notebook:
			api("SYNO.NoteStation.Notebook", 2, "delete", object_id=created_notebook, recursive="true")
	except Exception as exc:
		print("cleanup notebook error:", exc, file=sys.stderr)
	try:
		if sid:
			post({"api": "SYNO.API.Auth", "version": "7", "method": "logout", "session": SESSION})
	except Exception:
		pass


def main() -> int:
	global sid, created_note, created_notebook
	login = post({
		"api": "SYNO.API.Auth",
		"version": "7",
		"method": "login",
		"account": ACCOUNT,
		"passwd": PASSWORD,
		"session": SESSION,
		"format": "sid",
	})
	print("login:", "OK" if login.get("success") else "FAIL")
	require(login.get("success"), f"login failed: {sanitize(login)}")
	sid = login["data"]["sid"]

	nb_title = PREFIX + " Notebook"
	response = api("SYNO.NoteStation.Notebook", 2, "create", title=nb_title, commit_msg={"device": "e2e"})
	require(response.get("success"), "create notebook failed")
	created_notebook = response["data"]["object_id"]

	response = api("SYNO.NoteStation.Notebook", 2, "get", object_id=created_notebook)
	require(response.get("success") and response["data"]["object_id"] == created_notebook, "get notebook failed")

	response = api("SYNO.NoteStation.Notebook", 2, "set", object_id=created_notebook, title=nb_title + " Updated", commit_msg={"device": "e2e"})
	require(response.get("success"), "update notebook failed")

	response = api("SYNO.NoteStation.Notebook", 2, "list", limit=5, offset=0)
	require(response.get("success"), "list notebook failed")

	note_title = PREFIX + " Note"
	html = "<div>Hello from n8n-nodes-synology E2E</div>"
	response = api("SYNO.NoteStation.Note", 3, "create", title=note_title, parent_id=created_notebook, encrypt="false", content=html, brief="E2E brief", commit_msg={"device": "e2e", "listable": False})
	require(response.get("success"), "create note failed")
	created_note = response["data"]["object_id"]

	response = api("SYNO.NoteStation.Note", 3, "get", object_id=created_note)
	require(response.get("success") and "Hello from n8n-nodes-synology E2E" in response["data"].get("content", ""), "get note/content failed")
	ver = response["data"].get("ver")
	appended = response["data"].get("content", "") + "<div>Append OK</div>"

	response = api("SYNO.NoteStation.Note", 3, "set", object_id=created_note, ver=ver, content=appended, brief="E2E brief updated", commit_msg={"device": "e2e", "listable": False})
	require(response.get("success"), "update note failed")

	response = api("SYNO.NoteStation.Note", 3, "get", object_id=created_note)
	require(response.get("success") and "Append OK" in response["data"].get("content", ""), "append content mismatch")

	response = api("SYNO.NoteStation.Note", 3, "list", limit=5, offset=0, filter={"parent_id": [created_notebook]})
	require(response.get("success"), "list notes failed")

	response = api("SYNO.NoteStation.Note", 3, "delete", object_id=created_note, recycle="false")
	require(response.get("success"), "delete note failed")
	created_note = None

	response = api("SYNO.NoteStation.Notebook", 2, "delete", object_id=created_notebook, recursive="true")
	require(response.get("success"), "delete notebook failed")
	created_notebook = None

	print(json.dumps({"success": True, "prefix": PREFIX}, ensure_ascii=False, indent=2))
	return 0


if __name__ == "__main__":
	try:
		raise SystemExit(main())
	except Exception as exc:
		print("E2E_FAIL:", exc, file=sys.stderr)
		raise SystemExit(1)
	finally:
		cleanup()
