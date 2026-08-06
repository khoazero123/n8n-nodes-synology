# Synology Photos — API Survey & Node Implementation (2026-08-06)

Verified live on DSM 7 / SynologyPhotos **1.9.1-10928**. Backend is
Node.js (js-server); APIs are served from the standard
**/webapi/entry.cgi** (NOT /photo/webapi/entry.cgi).

## Auth
- Session: **FileStation** (Photos does not register its own DSM session —
  `SYNO.API.Auth` with session=Foto returns error 402).
- Same `_sid` + `X-SYNO-TOKEN` flow as other apps.

## API namespaces (versions from live SYNO.API.Info query)

| API | Max v | Methods used |
|---|---|---|
| SYNO.Foto.Browse.Album | 5 | list (offset, limit) |
| SYNO.Foto.Browse.NormalAlbum | 4 | list |
| SYNO.Foto.Browse.ConditionAlbum | 4 | list |
| SYNO.Foto.Browse.Folder | 2 | list (offset, limit, id) |
| SYNO.Foto.Browse.Item | 7 | list (album_id \| folder_id, type, additional) |
| SYNO.Foto.Thumbnail | 2 | get (id, cache_key, type=unit, size=sm/m/xl) → **binary** |
| SYNO.Foto.Download | 2 | download (unit_id=[id], cache_key) → **binary** |
| SYNO.Foto.Search.Search | 7 | search (keyword, ...) — needs more params (103) |
| SYNO.FotoTeam.Browse.Folder | 2 | list (Shared Space) |
| SYNO.FotoTeam.Browse.Item | 1 | list (Shared Space) |

## Key findings
- `Item.list` with `additional: ["thumbnail","resolution","orientation"]`
  returns `cache_key` per item — REQUIRED for thumbnail/download.
- `Thumbnail.get` / `Download.download` return **raw binary** (JPEG) —
  use requestBinary + prepareBinaryData.
- `Item.get` (any version) returns `{list: []}` — item details only come
  via list with additional. `Browse.Unit.get` needs `id_item` but also
  returns empty; item detail API appears unavailable in 1.9.1.
- Search.Search requires more params than keyword/offset/limit (error 103);
  exact contract not yet pinned (UI bundle is minified).
- Personal space = SYNO.Foto.*, Shared space = SYNO.FotoTeam.*.

## Node: SynologyPhotos
- Album: List / List Normal / List Conditional
- Folder: List Personal Space / List Shared Space
- Item: List (album or folder + type + thumbnail info), Get Thumbnail
  (binary), Download Original (binary)
- E2E test/e2e-photos-n8n.js — 5/5 pass live (albums → items → cache_key
  → thumbnail binary → download 243KB verified).
