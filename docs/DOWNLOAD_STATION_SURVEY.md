# Download Station Node — Phase 1 Survey & Design

Date: 2026-08-05

## 1. Executive Summary

Download Station WebAPI has two API generations:
- **V1 (`SYNO.DownloadStation.Task`)**: Officially documented (PDF 2014), methods `list`, `getinfo`, `create`, `delete`, `pause`, `resume`, `edit`.
- **V2 (`SYNO.DownloadStation2.Task`)**: No official documentation, "reserved for internal use by Synology" but used in practice by Download Station 4.1.2 frontend on DSM 7.x. Path `DownloadStation/entry.cgi`, method `create`; URL uses `type=url`, `url` as array; torrent upload uses `type=file` and multipart file field `torrent`.

**Decision:** Phase 1 implements V1 API only (clear, documented contract). V2 is only used in opt-in destructive tests; no V2 fallback in the node yet because it is internal/undocumented and error/response contracts still need verification per DSM version.

## 2. Verified References

| # | Source | Type | Notes |
|---|--------|------|-------|
| 1 | [Synology Download Station Web API PDF](https://global.download.synology.com/download/Document/Software/DeveloperGuide/Package/DownloadStation/All/enu/Synology_Download_Station_Web_API.pdf) | Official doc | 2014-03-26, last revision. Documents V1 only. |
| 2 | [autobrr feature req #1356](https://github.com/autobrr/autobrr/issues/1356) | Community tested | Tested DSM 7.2.1 + DS 4.0.1-4709. Concrete V2 create endpoint with curl examples. |
| 3 | [synology-api Python lib](https://n4s4.github.io/synology-api/docs/apis/classes/downloadstation) | Maintained client | V2-first with V1 fallback. Comprehensive method list, partial docs. |
| 4 | [syno-download-station Rust lib](https://github.com/artemy/syno-download-station) | Maintained client | Clean Rust implementation. create/pause/resume/delete/list/get_tasks. V2 focus. |
| 5 | [Reddit: Download Station API DSM7](https://www.reddit.com/r/synology/comments/1tiyyrm/download_station_api/) | Community | Confirms V1 create fails on DSM7; need `SYNO.DownloadStation2.Task` + `type=file` multipart for torrent upload. |
| 6 | [nas-download-manager #177](https://github.com/seansfkelley/nas-download-manager/issues/177) | Bug report | V1 create returns "Invalid parameter" after DS 3.8.16 update (2021). Confirms unannounced API break. |

## 3. Existing Repository Patterns

The repo already has reusable infrastructure:

### Transport Layer (`transport/SynologyClient.ts`)
- `SynologyClient` class: login/logout via `SYNO.API.Auth` (v7), session caching.
- `request()`: POST `webapi/entry.cgi`, url-encoded, auto-inject `_sid`.
- `requestBinary()`: POST for binary responses (downloads).
- `requestMultipart()`: POST multipart/form-data (upload torrent files).
- **100% reusable for Download Station** — only need to pass `session='DownloadStation'`.

### Credential (`credentials/SynologyApi.credentials.ts`)
- Shared `synologyApi` credential (baseUrl, username, password, allowUnauthorizedCerts).
- **Reuse with no changes.**

### Pattern: NoteStation node
- Node definition (`SynologyNoteStation.node.ts`): Resource + Operation dropdown, execute switch-case, calls `NoteStationClient`.
- Client class (`apps/noteStation/NoteStationClient.ts`): Wraps `SynologyClient`, each method calls `this.synology.request({...})`.
- Constants (`apps/noteStation/constants.ts`): API strings, version numbers.
- **Download Station will follow this pattern.**

### Package manifest (`package.json`)
- `n8n.nodes` array already had 2 nodes. Added `dist/nodes/SynologyDownloadStation/SynologyDownloadStation.node.js`.

## 4. Contract: Endpoints & Parameters

### 4.1 Auth Session
```
API: SYNO.API.Auth
Version: 7
Method: login
Params: account, passwd, session=DownloadStation, format=sid
```
→ Reuse `SynologyClient.login('DownloadStation')`.

### 4.2 API Discovery (runtime)
```
GET /webapi/query.cgi?api=SYNO.API.Info&version=1&method=query&query=SYNO.DownloadStation.Task,SYNO.DownloadStation2.Task,SYNO.DownloadStation.Info,SYNO.DownloadStation.Statistic,SYNO.DownloadStation.BTSearch,SYNO.DownloadStation.Schedule
```
Returns `path`, `minVersion`, `maxVersion` per API — used to decide V1 vs V2.

### 4.3 SYNO.DownloadStation.Info (V1, Documented)
| Method | Path | Params | Returns |
|--------|------|--------|---------|
| `getinfo` | `DownloadStation/info.cgi` | none | is_manager, version, torrent settings |
| `getconfig` | `DownloadStation/info.cgi` | none | bt_max_download, bt_max_upload, default_destination, emule_enabled, etc. |
| `setserverconfig` | `DownloadStation/info.cgi` | bt_max_download?, bt_max_upload?, default_destination?, ... | success |

### 4.4 SYNO.DownloadStation.Task (V1, Documented)
| Method | Params | Returns |
|--------|--------|---------|
| `list` | `offset?`, `limit?`, `additional?` (detail,transfer,file,tracker,peer) | `{ total, offset, tasks[] }` |
| `getinfo` | `id` (comma-separated), `additional?` | `{ tasks[] }` with additional objects |
| `create` | `uri?` (URL/magnet), `file?` (torrent data via multipart), `destination?`, `username?`, `password?` | success (⚠️ may fail on DSM7) |
| `delete` | `id`, `force_complete?` | `[{id, error}]` |
| `pause` | `id` | `[{id, error}]` |
| `resume` | `id` | `[{id, error}]` |
| `edit` | `id`, `destination?` | `[{id, error}]` |

**Task Object (response):**
```typescript
{
  id: string;           // "dbid_XXX"
  type: string;         // "bt" | "nzb" | "http" | "ftp" | "emule"
  username: string;
  title: string;
  size: string;         // bytes as string
  status: string;       // see status codes below
  status_extra?: object;
  additional?: {
    detail?: TaskDetail;
    transfer?: TaskTransfer;
    file?: TaskFile[];
    tracker?: TaskTracker[];  // BT only
    peer?: TaskPeer[];        // BT only
  };
}
```

**Task Status Codes (Appendix A, official PDF):**
| Code | Status |
|------|--------|
| 1 | waiting |
| 2 | downloading |
| 3 | paused |
| 4 | finishing |
| 5 | finished |
| 6 | hash_checking |
| 7 | seeding |
| 8 | filehosting_waiting |
| 9 | extracting |
| 10 | error |

**TaskDetail:**
```
destination, uri, create_time, priority (auto/low/normal/high),
total_peers, connected_seeders, connected_leechers
```

**TaskTransfer:**
```
size_downloaded, size_uploaded, speed_download, speed_upload
```

### 4.5 SYNO.DownloadStation2.Task (V2, Not Officially Documented)
| Method | Params | Notes |
|--------|--------|-------|
| `create` | `type=url`, `url`, `destination?`, `create_list?` | URL/magnet. Tested working DSM 7.2.1. |
| `create` | `type=file`, `file=["torrent"]`, multipart field `torrent`, `destination` (JSON-encoded), `create_list` | Frontend upload callback receives `data.list_id`; task/list handling still needs E2E verification |
| `list` | `offset?`, `limit?`, `additional?` | Same response shape. |
| `getinfo` | `id`, `additional?` | Same response shape. |
| `delete` | `id` | ... |
| `pause` | `id` | ... |
| `resume` | `id` | ... |

**Path:** `DownloadStation/entry.cgi` (different from V1's `DownloadStation/task.cgi`)

**Frontend evidence (NAS Download Station 4.1.2-5012, read-only inspection):** `ui/download.js` defines `QueueAddFile.FILEFILEDNAME="torrent"`, `type="file"`, hidden `file=["torrent"]`, and `QueueAddFileUploader` posts `api=SYNO.DownloadStation2.Task`, `version=2`, `method=create`. It sends `destination` as JSON and `create_list` as a boolean. The upload completion handler reads `response.data.list_id`. This identifies the multipart contract, but does not yet prove the full server response/task lifecycle.

**Controlled live probe (2026-08-05 → 2026-08-06):** initial non-browser-shaped requests returned `success=false, error.code=119` before creating a task. Frontend-contract analysis found: upload URL is `entry.cgi/SYNO.DownloadStation2.Task` (API in the path, not only `entry.cgi`), HTML5 uploader appends multipart fields `size=<file.size>` and `mtime=<Date.now()>`. A later **Playwright UI capture** (DSM login via real browser) showed the exact frontend multipart shape: URL `/webapi/entry.cgi/SYNO.DownloadStation2.Task`, form body still includes `api=SYNO.DownloadStation2.Task`, `method=create`, `version=2`; fields in order `api, method, version, type, file, destination, create_list, mtime, size, torrent`; `type="file"` and `file=["torrent"]` are JSON-quoted, `create_list` is a raw boolean, file part uses `application/x-bittorrent`. Authentication: DSM session cookie (`Cookie: id=<sid>`) + `X-SYNO-TOKEN` header (login with `enable_syno_token=yes`). `_sid`-only multipart returns 119/101. With `create_list=false` the response is `data.task_id=["dbid_XXXX"]`; with `create_list=true` it is `data.list_id=["btdlXXXX"]` (task created only after the file-selection dialog is confirmed). Full lifecycle verified 2026-08-06: create → getinfo → pause → resume → delete all return `error: 0`.

**Root-cause found for earlier `code=101` replays (2026-08-06):** a Python probe bug — building the multipart body with an f-string containing a `bytes` value (`{crlf}` where `crlf=b"\r\n"`) emitted the literal repr `b'\r\n'` instead of real CRLF bytes, so `synoupload.c` failed with `failed to find parameter 'name'` / `cannot get parameter name`. The n8n TypeScript implementation uses a `'\r\n'` string and is unaffected. Also discovered: **V1 `create` (URL) actually works on DSM 7** — earlier `error 403` was caused by the default destination `home/Drive/Download` not existing; after creating that folder, V1 create URL succeeded (`{"success":true}`, task downloadable). The default destination must exist on the NAS for both V1 and V2 create.

⚠️ **V2 caveat from Python lib docs:** "the V2 API is reserved by Synology for internal use and may return 'Preserve for other purpose' on most DSM installations." Verify on a real NAS.

### 4.6 SYNO.DownloadStation.Statistic (V1)
| Method | Path | Returns |
|--------|------|---------|
| `getinfo` | `DownloadStation/statistic.cgi` | speed_download, speed_upload, emule_speed_download, emule_speed_upload |

## 5. Endpoints/Params To Verify (Blockers)

| # | Issue | Priority | How to Verify |
|---|-------|----------|---------------|
| 1 | **Does V1 `create` work on DSM7?** | ✅ VERIFIED | **Yes, it works** — earlier 403 was because default destination `home/Drive/Download` did not exist. After creating that folder, V1 create URL succeeded (`{"success":true}`) and the task downloaded normally. |
| 2 | **Does V2 API return "Preserve for other purpose"?** | ✅ VERIFIED | `SYNO.DownloadStation2.Task` exists (path=`entry.cgi`, min=1, max=2, requestFormat=JSON). Works in practice for torrent upload. |
| 3 | **Exact path for V2** | 🟡 HIGH | Per autobrr: `DownloadStation/entry.cgi`. Confirm on NAS. |
| 4 | **Multipart torrent upload V2** | ✅ VERIFIED | Frontend contract and controlled NAS E2E verified (2026-08-06, task dbid_10xx created/listed/deleted). V2 multipart requires DSM session cookie + `X-SYNO-TOKEN`; with `create_list=false` returns `data.task_id`, with `create_list=true` returns `data.list_id` (file-selection dialog flow).
| 5 | **`create_list` param in V2** | ✅ VERIFIED | `create_list=true` → response `data.list_id=["btdlXXXX"]`, `task_id=[]` (UI opens file-selection dialog, task created after confirm). `create_list=false` → `data.task_id=["dbid_XXXX"]` directly. |
| 6 | **V1 `file` param (torrent upload)** | 🟢 MEDIUM | Official doc mentions `file`, but DSM 7.2/Download Station 4.1.2 frontend uses V2 `type=file`; V1 multipart should not be implemented yet. |
| 7 | **`SYNO.DownloadStation.Task.List` endpoint** | ✅ VERIFIED | `SYNO.DownloadStation2.Task.List` exists (path=`entry.cgi`, min=1, max=2, methods get/download/delete). Used to fetch file list of task/list. |
| 8 | **Task ID format** | 🟢 LOW | V1 uses `dbid_XXX`. Does V2 use a different format? |

## 6. Minimum Resource/Operations Proposal

### Resource: `task`
| Operation | V1 Method | V2 Method | Input params |
|-----------|-----------|-----------|--------------|
| `createUrl` | `create` (uri=) | `create` (type=url) | url, destination? — **V1→V2 fallback verified 2026-08-06 (V1 works on DSM7 when destination exists; V2 `type=url` requires `create_list`)** |
| `createTorrent` | `create` (file=) | `create` (type=file), multipart field `torrent` | **Implemented; full lifecycle verified 2026-08-06 (create→getinfo→pause→resume→delete, cookie/token auth, cleanup)** |
| `edit` | `edit` | `edit` | taskId, destination?, priority? (low/normal/high) — **verified** |
| `downloadSource` | — | `SYNO.DownloadStation2.Task.Source` v2 `download` | taskId → binary torrent file (md5 identical to original) — **verified** |
| `getAll` | `list` | `list` | offset?, limit?, additional? |
| `get` | `getinfo` | `getinfo` | taskId, additional? |
| `pause` | `pause` | `pause` | taskId |
| `resume` | `resume` | `resume` | taskId |
| `delete` | `delete` | `delete` | taskId, forceComplete? |

### Resource: `taskList`
| Operation | Method | Input params |
|-----------|--------|--------------|
| `getFiles` | `SYNO.DownloadStation2.Task.List` v2 `get` | listId → files/title/size — **verified** |
| `confirmDownload` | `SYNO.DownloadStation2.Task.List.Polling` v2 `download` | listId, destination (**required**), create_subfolder?, selected? → polling task_id — **verified** |
| `getDownloadStatus` | `...Task.List.Polling` v2 `download_status` | polling task_id → `{data:{task_id:[...]}, finish}` — **verified** |
| `stopDownload` | `...Task.List.Polling` v2 `download_stop` | polling task_id — **verified** |
| `delete` | `SYNO.DownloadStation2.Task.List` v2 `delete` | listId — **verified** |

### Resource: `statistics`
| Operation | Method | Input |
|-----------|--------|-------|
| `get` | `SYNO.DownloadStation.Statistic.getinfo` | none |

### Resource: `info` (phase 3)
| Operation | Method | Input |
|-----------|--------|-------|
| `get` | `SYNO.DownloadStation.Info.getinfo` (v2) | none |
| `getConfig` | `SYNO.DownloadStation.Info.getconfig` (v2) | none |

### Resource: `btSearch` (phase 3, verified read-only)
| Operation | Method | Input |
|-----------|--------|-------|
| `search` | `SYNO.DownloadStation.BTSearch.list` (v1, path `DownloadStation/btsearch.cgi`) | keyword, module?, limit?, offset? |

**Live NAS probe (2026-08-05):** `list` returns `{items, offset, total}` ✅; `get` (module list) returns error 103; `SYNO.DownloadStation.RSS` and `SYNO.DownloadStation.Task.SchedTask` do not exist on this NAS; `SYNO.DownloadStation.Schedule` v1 is exposed but `get`/`list`/`set` all return 103 with the current account → contract not yet verified.

### Future (after phase 1):
- Resource `info`: setConfig (mutation)
- Resource `schedule`: awaiting contract verification (NAS currently returns 103)
- Resource `rss`: not available on this NAS
- Resource `btSearch`: start, clean (search result lifecycle — not yet verified)

## 7. Planned Types

```typescript
// apps/downloadStation/types.ts
interface DownloadStationCredentials {
  baseUrl: string;
  username: string;
  password: string;
  allowUnauthorizedCerts?: boolean;
}

type TaskType = 'bt' | 'nzb' | 'http' | 'ftp' | 'emule';
type TaskStatus = 'waiting' | 'downloading' | 'paused' | 'finishing' | 'finished' 
                 | 'hash_checking' | 'seeding' | 'filehosting_waiting' | 'extracting' | 'error';
type TaskPriority = 'auto' | 'low' | 'normal' | 'high';
type AdditionalField = 'detail' | 'transfer' | 'file' | 'tracker' | 'peer';

interface TaskDetail {
  destination: string;
  uri: string;
  create_time: string;
  priority: TaskPriority;
  total_peers: number;
  connected_seeders: number;
  connected_leechers: number;
}

interface TaskTransfer {
  size_downloaded: string;
  size_uploaded: string;
  speed_download: number;
  speed_upload: number;
}

interface TaskFile {
  filename: string;
  size: string;
  size_downloaded: string;
  priority: TaskPriority;
}

interface DownloadTask {
  id: string;
  type: TaskType;
  username: string;
  title: string;
  size: string;
  status: TaskStatus;
  status_extra?: Record<string, unknown>;
  additional?: {
    detail?: TaskDetail;
    transfer?: TaskTransfer;
    file?: TaskFile[];
    tracker?: Record<string, unknown>[];
    peer?: Record<string, unknown>[];
  };
}

interface DownloadStationStatistics {
  speed_download: number;
  speed_upload: number;
  emule_speed_download: number;
  emule_speed_upload: number;
}
```

## 8. New Files To Create

```
apps/downloadStation/DownloadStationClient.ts   # Client class wrapping SynologyClient
apps/downloadStation/constants.ts                # API strings, versions, session name
apps/downloadStation/types.ts                    # TypeScript interfaces
nodes/SynologyDownloadStation/
  SynologyDownloadStation.node.ts                # Node definition
  SynologyDownloadStation.svg                    # Light icon
  SynologyDownloadStation-dark.svg               # Dark icon
```

## 9. E2E Feasibility

- **Feasible:** Test NAS `192.168.1.100:5000` already used for Note Station and Drive E2E.
- **Needed:** Scripts `test/e2e-download-station-core.py` (direct API test) + `test/e2e-download-station-n8n.js` (workflow-level).
- **Test flow:** Auth → query available APIs → create URL task → list → getinfo → pause → resume → delete → statistics.
- **Risk:** If V1 create does not work on the test NAS, switch to verifying V2 create before implementing the node.

## 10. Next Steps (Do Not Commit)

1.  ~~**Verify API availability on NAS:** Run `curl` query `SYNO.API.Info` with query=ALL, filter DownloadStation endpoints to determine V1/V2 path + version.~~
2.  **Test V1 create vs V2 create:** not run yet because this creates real tasks on the NAS; requires explicit approval before running.
3.  ~~**Create `apps/downloadStation/constants.ts` + `types.ts`** based on verified contract.~~ ✅
4.  ~~**Implement `DownloadStationClient`** following `NoteStationClient` pattern.~~ ✅
5.  ~~**Implement node definition** `SynologyDownloadStation.node.ts`.~~ ✅
6.  **E2E test** direct API → n8n workflow. Read-only n8n workflow ✅; destructive direct CRUD script available but not run without explicit approval.
7.  ~~**Update `package.json`** add node to `n8n.nodes`.~~ ✅

### Implementation Complete (2026-08-05)

Phase 1 covers the documented V1 operations (create with V1→V2 fallback, list, get, pause, resume, delete, edit) plus verified read-only Info/BTSearch, the full V2 task-list flow (create_list=true → Task.List get/confirm/status/delete), and torrent source download. Torrent upload and task-list flows are verified against the live NAS through the frontend-compatible V2 multipart contract and cookie/token authentication.

- `apps/downloadStation/constants.ts` — API strings, session name, task status map, additional fields
- `apps/downloadStation/types.ts` — TypeScript interfaces for tasks, statistics, inputs
- `apps/downloadStation/DownloadStationClient.ts` — Client class wrapping SynologyClient with `requestPath()` for app-specific CGI paths
- `nodes/SynologyDownloadStation/SynologyDownloadStation.node.ts` — Node definition with task (createTorrent, createUrl, downloadSource, edit, getMany, get, pause, resume, delete), taskList (getFiles, confirmDownload, getDownloadStatus, stopDownload, delete), statistics (get) and info (get, getConfig) operations
- `nodes/SynologyDownloadStation/SynologyDownloadStation.svg` + `-dark.svg` — Copied themed icons from NoteStation (placeholder)
- Extended `SynologyClient` with `requestPath()` method for app-specific webapi paths
- Updated `package.json` `n8n.nodes` entry
- Updated `docs/ROADMAP.md` Phase 3 section with implementation details
- Build passes (`n8n-node build` + bundle)
- Lint passes (`n8n-node lint`)
- Package dry-run passes (`npm pack --dry-run`) — 54 files, 58.7 kB
