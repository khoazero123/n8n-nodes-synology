# Synology Note Station API Discovery

Discovery source: local NAS package files and Note Station frontend JavaScript.

Package paths:

- `/var/packages/NoteStation/target/webapi/SYNO.NoteStation.lib`
- `/var/packages/NoteStation/target/webapi/*/*.so`
- `/usr/syno/synoman/webman/3rdparty/NoteStation/notestation.js`

## Auth

| API | Version | Method | Params | Status |
| --- | --- | --- | --- | --- |
| `SYNO.API.Auth` | 7 | `login` | `account`, `passwd`, `session=NoteStation`, `format=sid` | tested previously |
| `SYNO.API.Auth` | 7 | `logout` | `session=NoteStation` | planned |

## Notebook

| API | Version | Method | Params | Status |
| --- | --- | --- | --- | --- |
| `SYNO.NoteStation.Notebook` | 2 | `list` | `filter`, `field`, `offset`, `limit`, `sort_by`, `sort_direction` | implemented |
| `SYNO.NoteStation.Notebook` | 2 | `get` | `object_id`, optional `link_id` | implemented |
| `SYNO.NoteStation.Notebook` | 2 | `create` | `title`, `commit_msg` | implemented |
| `SYNO.NoteStation.Notebook` | 2 | `set` | `object_id`, `title`, `stack`, `commit_msg` | implemented |
| `SYNO.NoteStation.Notebook` | 2 | `delete` | `object_id`, `recursive` | implemented |

## Note

| API | Version | Method | Params | Status |
| --- | --- | --- | --- | --- |
| `SYNO.NoteStation.Note` | 3 | `list` | `filter`, `field`, `offset`, `limit`, `sort_by`, `sort_direction`, `mode`, `stack`, `perm_from`, `smart_id`, `link_id` | implemented |
| `SYNO.NoteStation.Note` | 3 | `get` | `object_id`, `ver`, `perm_from`, `smart_id` | implemented |
| `SYNO.NoteStation.Note` | 3 | `create` | `title`, `parent_id`, `encrypt`, `content`, `brief`, `ctime`, `mtime`, `latitude`, `longitude`, `commit_msg` | implemented basic unencrypted |
| `SYNO.NoteStation.Note` | 3 | `set` | `object_id`, `ver`, `content`, `brief`, `tag`, `title`, `source_url`, `latitude`, `longitude`, `location`, `parent_id`, `encrypt`, `recycle`, `token`, `commit_msg` | implemented basic unencrypted |
| `SYNO.NoteStation.Note` | 3 | `delete` | `object_id`, `recycle`, `perm_from`, `smart_id` | implemented |
| `SYNO.NoteStation.Note` | 3 | `restore` | `object_id`, `perm_from`, `smart_id` | planned |
| `SYNO.NoteStation.Note` | 3 | `copy` | note fields plus `title_postfix`, `old_password`, `new_password` | planned |

## Advanced APIs discovered

| API | Version | Methods | Purpose |
| --- | --- | --- | --- |
| `SYNO.NoteStation.Note.Encrypt` | 1 | `create`, `check`, `delete` | Encrypted note token lifecycle |
| `SYNO.NoteStation.Permission.Public` | 1 | `set`, `delete` | Public permissions/share; params `object_id`, `perm` (`ro`/`rw`) |
| `SYNO.NoteStation.Permission.User` | 1 | `set`, `delete` | User permissions |
| `SYNO.NoteStation.Permission.Group` | 1 | `set`, `delete` | Group permissions |
| `SYNO.NoteStation.Share.Priv` | 2 | `list` | Private shared items |
| `SYNO.NoteStation.Permission` | 1 | `set` | Enables ACL before setting public/user/group permissions |
| `SYNO.NoteStation.Shard.Link` | 1 | `get` | Public/private share link retrieval; params `object_id`, `mode` |
| `SYNO.NoteStation.Stack` | 1 | `set`, `delete` | Shelf/stack management; `set` params `stack_id`, `name`; `delete` param `stack_id` |
| `SYNO.NoteStation.Shortcut` | 1 | `list`, `set`, `delete` | Shortcuts |
| `SYNO.NoteStation.Tag` | 2 | `list`, `set`, `delete` | Tags |

## Attachment notes

The implemented node/client attachment contract is:

- List: `SYNO.NoteStation.Note` v3 `get`, returning `data.attachment` from the note payload.
- Upload: `SYNO.NoteStation.Note` v3 `set` as multipart `FormData`, with `html5upload=true`, params `object_id`, `ver`, `commit_msg`, and `attachment: [{ action: 'create', format: 'raw', name: <unique multipart field name> }]`; the uploaded file part is keyed by the original filename. This mirrors the DSM Note Station frontend contract.
- Download/get: `SYNO.NoteStation.AppLink` v1 `get`, posted to `webapi/entry.cgi` with `object_id`, `ver`, `file_id`, optional `token`, and binary response handling.
- Delete: `SYNO.NoteStation.Note` v3 `set`, with params `object_id`, `ver`, and `attachment: [{ action: 'delete', file_id: <file_id> }]`.

Reusable n8n workflow-level attachment binary E2E script: `test/e2e-n8n-notestation-attachments.js`. It creates a temporary notebook/note, generates a binary input in n8n, uploads it as a Note Station attachment, lists attachments, downloads by `file_id`, verifies downloaded bytes, and cleans up attachment/note/notebook in `finally`. On the current NAS, the upload probe is blocked by `SYNO.NoteStation.Note.set` error `105` with `errors.synodrive=0`; keep this E2E optional until the Synology Drive dependency is healthy.

## E2E result 2026-08-04

Core CRUD was tested against NAS `192.168.1.100:5000` with temporary data prefix `n8n-nodes-synology E2E 1785850054`.

Passed:

- Notebook create/get/set/list/delete
- Note create/get/set/list/delete
- Create note response returned `content: "<div></div>"`, but follow-up `get` returned the real saved HTML content.
- Temporary test notebook and note were deleted successfully.

Reusable test script: `test/e2e-note-station-core.py`.
Credentials are provided via env vars only and are not stored in the repo.


## n8n Workflow E2E

Reusable n8n workflow-level E2E script: `test/e2e-n8n-workflow.js`.

It automatically:

- Builds this package.
- Starts an isolated local n8n instance, unless `N8N_BASE_URL` is supplied.
- Loads the package through n8n's custom-node folder.
- Sets up/logs in an owner user.
- Creates a Synology credential from env vars.
- Creates a real n8n workflow using `CUSTOM.synologyNoteStation`.
- Executes the workflow.
- Polls `/rest/executions/:id?includeData=true` and parses execution data with `flatted`.
- Cleans up the temporary notebook after share tests.

Usage:

```bash
SYNO_BASE_URL='http://192.168.1.100:5000' SYNO_ACCOUNT='nasadmin' SYNO_PASS='...' node test/e2e-n8n-workflow.js
```

Current workflow coverage:

- Notebook create/delete
- Note create with `Return Full Note`
- Public share set/get-link/delete
