# Download Station Node — Khảo Sát & Thiết Kế Giai Đoạn 1

Ngày: 2026-08-05

## 1. Kết Luận Ngắn

Download Station WebAPI có hai generation API:
- **V1 (`SYNO.DownloadStation.Task`)**: Documented chính thức (PDF 2014), các method `list`, `getinfo`, `create`, `delete`, `pause`, `resume`, `edit`.
- **V2 (`SYNO.DownloadStation2.Task`)**: Không có tài liệu chính thức, "reserved for internal use by Synology" nhưng thực tế hoạt động trên DSM 7.x + Download Station 4.x. Path khác (`DownloadStation/entry.cgi` thay vì `DownloadStation/task.cgi`), method `create` dùng `type=url` thay vì `uri`.

**Quyết định:** Ưu tiên implement V1 API (có contract rõ ràng, documented), đồng thời hỗ trợ fallback V2 cho `create` task (nhiều client maintained dùng V2 do V1 `create` bị lỗi trên DSM7 gần đây). Strategy: discover API versions thực tế từ `SYNO.API.Info` query tại runtime.

## 2. Nguồn Tham Khảo Đã Xác Minh

| # | Nguồn | Loại | Ghi Chú |
|---|-------|------|---------|
| 1 | [Synology Download Station Web API PDF](https://global.download.synology.com/download/Document/Software/DeveloperGuide/Package/DownloadStation/All/enu/Synology_Download_Station_Web_API.pdf) | Official doc | 2014-03-26, last revision. Documents V1 only. |
| 2 | [autobrr feature req #1356](https://github.com/autobrr/autobrr/issues/1356) | Community tested | Tested DSM 7.2.1 + DS 4.0.1-4709. Concrete V2 create endpoint with curl examples. |
| 3 | [synology-api Python lib](https://n4s4.github.io/synology-api/docs/apis/classes/downloadstation) | Maintained client | V2-first with V1 fallback. Comprehensive method list, partial docs. |
| 4 | [syno-download-station Rust lib](https://github.com/artemy/syno-download-station) | Maintained client | Clean Rust implementation. create/pause/resume/delete/list/get_tasks. V2 focus. |
| 5 | [Reddit: Download Station API DSM7](https://www.reddit.com/r/synology/comments/1tiyyrm/download_station_api/) | Community | Xác nhận V1 create bị lỗi trên DSM7, cần dùng `SYNO.DownloadStation2.Task` + `type=file` multipart cho torrent upload. |
| 6 | [nas-download-manager #177](https://github.com/seansfkelley/nas-download-manager/issues/177) | Bug report | V1 create bị "Invalid parameter" sau DS 3.8.16 update (2021). Xác nhận API break unannounced. |

## 3. Repository Patterns Hiện Có

Repo đã có infrastructure sẵn để reuse:

### Transport Layer (`transport/SynologyClient.ts`)
- `SynologyClient` class: login/logout qua `SYNO.API.Auth` (v7), session caching.
- `request()`: POST `webapi/entry.cgi`, url-encoded, auto-inject `_sid`.
- `requestBinary()`: POST for binary responses (downloads).
- `requestMultipart()`: POST multipart/form-data (upload torrent files).
- **Có thể reuse 100% cho Download Station**, chỉ cần pass `session='DownloadStation'`.

### Credential (`credentials/SynologyApi.credentials.ts`)
- Shared `synologyApi` credential (baseUrl, username, password, allowUnauthorizedCerts).
- **Reuse không cần thay đổi.**

### Pattern: NoteStation node
- Node definition (`SynologyNoteStation.node.ts`): Resource + Operation dropdown, execute switch-case, gọi `NoteStationClient`.
- Client class (`apps/noteStation/NoteStationClient.ts`): Wraps `SynologyClient`, mỗi method gọi `this.synology.request({...})`.
- Constants (`apps/noteStation/constants.ts`): API strings, version numbers.
- **Sẽ theo pattern này cho Download Station.**

### Package manifest (`package.json`)
- `n8n.nodes` array đã có 2 nodes. Cần thêm `dist/nodes/SynologyDownloadStation/SynologyDownloadStation.node.js`.

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
GET /webapi/query.cgi?api=SYNO.API.Info&version=1&method=query&query=SYNO.DownloadStation.Task,SYNO.DownloadStation2.Task,SYNO.DownloadStation.Info,SYNO.DownloadStation.Statistic
```
Trả về `path`, `minVersion`, `maxVersion` cho từng API — dùng để quyết định V1 vs V2.

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
| `getinfo` | `id` (comma-separated), `additional?` | `{ tasks[] }` với additional objects |
| `create` | `uri?` (URL/magnet), `file?` (torrent data via multipart), `destination?`, `username?`, `password?` | success (⚠️ có thể fail trên DSM7) |
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
| `create` | `type=file`, `file` (multipart), `destination?`, `create_list?` | Torrent file upload. Multipart. |
| `list` | `offset?`, `limit?`, `additional?` | Same response shape. |
| `getinfo` | `id`, `additional?` | Same response shape. |
| `delete` | `id` | ... |
| `pause` | `id` | ... |
| `resume` | `id` | ... |

**Path:** `DownloadStation/entry.cgi` (different from V1's `DownloadStation/task.cgi`)

⚠️ **V2 caveat from Python lib docs:** "the V2 API is reserved by Synology for internal use and may return 'Preserve for other purpose' on most DSM installations." Cần verify trên NAS thực tế.

### 4.6 SYNO.DownloadStation.Statistic (V1)
| Method | Path | Returns |
|--------|------|---------|
| `getinfo` | `DownloadStation/statistic.cgi` | speed_download, speed_upload, emule_speed_download, emule_speed_upload |

## 5. Endpoints/Params Cần Xác Minh (Blockers)

| # | Vấn Đề | Priority | Cách Verify |
|---|--------|----------|-------------|
| 1 | **V1 `create` có hoạt động trên DSM7 không?** | 🔴 CRITICAL | curl POST `SYNO.DownloadStation.Task` v1 method=create với URL đơn giản. Nếu fail → chỉ dùng V2. |
| 2 | **V2 API có trả về "Preserve for other purpose" không?** | 🔴 CRITICAL | Query `SYNO.API.Info` xem `SYNO.DownloadStation2.Task` có trong response không. Nếu không → fallback V1. |
| 3 | **Đường dẫn chính xác cho V2** | 🟡 HIGH | Theo autobrr: `DownloadStation/entry.cgi`. Cần xác nhận trên NAS. |
| 4 | **Multipart torrent upload V2** | 🟡 HIGH | Xác minh field name là `file`, response format sau upload, cách parse task_id trả về. |
| 5 | **`create_list` param trong V2** | 🟢 MEDIUM | Ý nghĩa chính xác? autobrr dùng `create_list=false`. Có cần cho torrent multi-file? |
| 6 | **V1 `file` param (torrent upload)** | 🟢 MEDIUM | Official doc có param `file` cho create. Format multipart? Field name? |
| 7 | **`SYNO.DownloadStation.Task.List` endpoint** | 🟢 MEDIUM | Python lib có reference tới `SYNO.DownloadStation2.Task.List` để get file list sau khi create. Tồn tại thực tế không? |
| 8 | **Task ID format** | 🟢 LOW | V1 dùng `dbid_XXX`. V2 có dùng format khác không? |

## 6. Đề Xuất Resource/Operations Tối Thiểu

### Resource: `task`
| Operation | V1 Method | V2 Method | Input params |
|-----------|-----------|-----------|--------------|
| `createUrl` | `create` (uri=) | `create` (type=url) | url, destination? |
| `createTorrent` | `create` (file=) | `create` (type=file) | binaryPropertyName, destination? |
| `getAll` | `list` | `list` | offset?, limit?, additional? |
| `get` | `getinfo` | `getinfo` | taskId, additional? |
| `pause` | `pause` | `pause` | taskId |
| `resume` | `resume` | `resume` | taskId |
| `delete` | `delete` | `delete` | taskId, forceComplete? |

### Resource: `statistics`
| Operation | Method | Input |
|-----------|--------|-------|
| `get` | `SYNO.DownloadStation.Statistic.getinfo` | none |

### Future (sau phase 1):
- Resource `info`: getDSInfo, getConfig, setConfig
- Resource `schedule`: get, set
- Resource `rss`: RSS site/feed operations
- Resource `btSearch`: start, list, clean

## 7. Types Dự Kiến

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

## 8. Files Cần Tạo Mới

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

- **Khả thi:** NAS test `192.168.1.175:5000` đã được dùng cho Note Station và Drive E2E.
- **Cần:** Tạo script `test/e2e-download-station-core.py` (direct API test) + `test/e2e-download-station-n8n.js` (workflow-level).
- **Test flow:** Auth → query available APIs → create URL task → list → getinfo → pause → resume → delete → statistics.
- **Risk:** Nếu V1 create không hoạt động trên NAS test, cần switch sang verify V2 create trước khi implement node.

## 10. Next Steps (Không Commit)

1.  ~~**Verify API availability trên NAS:** Chạy `curl` query `SYNO.API.Info` với query=ALL, lọc DownloadStation endpoints để xác định V1/V2 path + version.~~
2.  **Test V1 create vs V2 create:** chưa chạy vì đây là thao tác tạo task thật trên NAS; cần explicit approval trước khi chạy.
3.  ~~**Tạo `apps/downloadStation/constants.ts` + `types.ts`** dựa trên contract đã verified.~~ ✅
4.  ~~**Implement `DownloadStationClient`** theo pattern `NoteStationClient`.~~ ✅
5.  ~~**Implement node definition** `SynologyDownloadStation.node.ts`.~~ ✅
6.  **E2E test** direct API → n8n workflow. Read-only n8n workflow ✅; destructive direct CRUD script available but not run without explicit approval.
7.  ~~**Cập nhật `package.json`** thêm node vào `n8n.nodes` và thêm npm scripts test.~~ ✅

### Implementation Complete (2026-08-05)

- `apps/downloadStation/constants.ts` — API strings, session name, task status map, additional fields
- `apps/downloadStation/types.ts` — TypeScript interfaces for tasks, statistics, inputs
- `apps/downloadStation/DownloadStationClient.ts` — Client class wrapping SynologyClient with `requestPath()` for app-specific CGI paths
- `nodes/SynologyDownloadStation/SynologyDownloadStation.node.ts` — Node definition with task (createUrl, getMany, get, pause, resume, delete) and statistics (get) operations
- `nodes/SynologyDownloadStation/SynologyDownloadStation.svg` + `-dark.svg` — Copied themed icons from NoteStation (placeholder)
- Extended `SynologyClient` with `requestPath()` method for app-specific webapi paths
- Updated `package.json` `n8n.nodes` entry
- Updated `docs/ROADMAP.md` Phase 3 section with implementation details
- Build passes (`tsc` + `gulp build:icons`)
- Lint passes (`eslint`)
- Package dry-run passes (`npm pack --dry-run`) — 54 files, 58.7 kB
