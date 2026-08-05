# n8n-nodes-synology Roadmap

`n8n-nodes-synology` is an umbrella n8n community node package for Synology NAS applications.

## Architecture

- One npm package: `n8n-nodes-synology`
- One shared credential: `Synology API`
- Shared transport layer for DSM/WebAPI login, request, upload, download, and error handling where the application API supports it
- One n8n node per Synology application

Planned nodes:

- Synology Note Station
- Synology Drive
- Synology Download Station
- Synology File Station
- Synology Photos
- Synology Calendar

## Phase 1: Note Station — baseline complete, feature parity pending

The initial Note Station node is implemented and passes the real n8n workflow E2E against the target NAS. The phase is **not yet feature-complete**: attachment CRUD is implemented and now has dedicated E2E coverage, but the target NAS currently blocks the upload path with `code=105`, `errors.synodrive=0`. Encryption and import/export baseline operations are implemented against the discovered Note Station contracts.

### Implemented and E2E-tested

- DSM authentication/session handling with `SYNO.API.Auth`, session `NoteStation`.
- Notebook create/get/list/update/delete.
- Note create/get/list/update/delete.
- Append/prepend note content.
- Full-note readback after create/update.
- Shelf/stack create/rename/delete.
- Public share set/get-link/delete.
- User/group share set/remove operations.
- Share principal listing.
- Tag listing.
- Note Station information lookup.
- Note version list/get/restore API wiring.
- Note restore operation wiring for recycle-bin restore.
- Native encryption token create/check/delete operations.
- Export start/status/download for Note, Word, and Notebook formats.
- ENEX and Notebook import from n8n binary input.

Real E2E coverage currently verifies notebook/note lifecycle, append, version listing, share principal listing, tags, info, public sharing, and cleanup. Version restore, recycle-bin restore, user/group share mutation, and shelf operations still need dedicated E2E cases.

### Still pending

- Re-run dedicated attachment binary E2E after the NAS Synology Drive dependency is repaired; current run creates a temporary notebook/note, reaches upload, then receives `SYNO.NoteStation.Note.set` error `105` with `errors.synodrive=0` and cleans up.
- Dedicated real E2E coverage for encryption, import/export, version restore, recycle-bin restore, and user/group share mutation. Shelf operations remain blocked on NAS API error 1032 (`synodrive`) during direct and n8n E2E probes.

Known tested API facts from local NAS discovery:

- Login: `SYNO.API.Auth`, version `7`, method `login`, `session=NoteStation`, `format=sid`.
- Notebook create: `SYNO.NoteStation.Notebook`, version `2`, method `create`, param `title`.
- Note create: `SYNO.NoteStation.Note`, version `3`, method `create`, params `title`, `parent_id`, `content`, optional `brief`, `commit_msg`.
- Create note response may not include the saved content; follow up with `get` when content verification is needed.

The pending items above are intentionally separated from the baseline because their API contracts or dedicated E2E coverage are not complete yet.

## Phase 2: Drive migration — complete

Functionality from `khoazero123/n8n-nodes-synology-drive` is integrated into this umbrella package as a `Synology Drive` node. The shared `Synology API` credential is reused. Drive's application REST API has a separate cookie-based login flow, so it is handled by the node rather than by the DSM WebAPI transport.

Existing Drive operations to preserve:

- List/search files and folders
- Get file/folder metadata and copy files/folders
- Upload binary data
- Create text files and folders
- Download files as binary output
- Delete files/folders, soft or permanent
- List Team Folders
- List/create/delete/apply Labels
- Create public and advanced sharing links

The Drive node currently covers the discovered file-management, label, team-folder, and sharing operations. Synology may expose additional version-dependent endpoints (for example permission management, link updates, trash, version history, office conversion, and file requests); those should be added only after their request and response schemas are verified against the target Drive Server version.

The Drive node is registered in the package manifest and passes the package build, ESLint, n8n community-node lint, and package dry-run checks.

## Phase 3: Download Station — baseline complete

The Download Station node is implemented and passes build, lint, and package dry-run checks.

### Implemented

- `task` resource: createUrl, getMany (list), get, pause, resume, delete
- `statistics` resource: get (current speeds)
- `info` resource: get, getConfig (read-only server configuration)
- `btSearch` resource: search (read-only keyword search)
- Uses V1 documented API (`SYNO.DownloadStation.Task` v3, `SYNO.DownloadStation.Statistic` v1, `SYNO.DownloadStation.Info` v2, `SYNO.DownloadStation.BTSearch` v1)
- App-specific CGI paths handled via `SynologyClient.requestPath()`:
  - `DownloadStation/task.cgi` for task CRUD
  - `DownloadStation/info.cgi` for info queries
  - `DownloadStation/statistic.cgi` for statistics
  - `DownloadStation/btsearch.cgi` for BT search
- Shares the `Synology API` credential and DSM session (`session=DownloadStation`)
- Binary torrent create is intentionally excluded from phase 1 (requires multipart contract verification)

### Verified NAS API discovery

- `SYNO.DownloadStation.Task` v3: path `DownloadStation/task.cgi` (V1, documented)
- `SYNO.DownloadStation.Info` v2: path `DownloadStation/info.cgi` (V1, documented)
- `SYNO.DownloadStation.Statistic` v1: path `DownloadStation/statistic.cgi` (V1, documented)
- `SYNO.DownloadStation.BTSearch` v1: path `DownloadStation/btsearch.cgi` (V1, documented; `list` = search verified on NAS)
- `SYNO.DownloadStation.Schedule` v1: path `DownloadStation/schedule.cgi` (exposed by NAS, but methods returned error 103 for the current account — pending)
- `SYNO.DownloadStation2.Task` v2: path `DownloadStation/entry.cgi` (V2, internal — reserved for future fallback)

### Pending

- Run the destructive direct CRUD E2E only with explicit approval (it creates and deletes a real NAS task); the default direct test is now read-only
- Binary torrent file upload (`create` with multipart/file param)
- V1 `create` verification on local NAS (may fail on DSM7; V2 fallback if needed)
- Resource-level operations: `info` config mutation (`setConfig`), `schedule`, `rss`
- `btSearch` `start`/`clean` (search result lifecycle) — only `list` (search) is verified so far

## Development checks

- `npm run build`
- `npm run lint`
- `npm pack --dry-run`
