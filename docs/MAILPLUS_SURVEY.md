# MailPlus Node — Survey & Implementation

Date: 2026-08-06

## 0. Mail vs MailPlus (naming)

Synology ships **two** DSM mail applications:

| App | Package / node (this repo) | Status |
|-----|---------------------------|--------|
| **MailPlus** | `SynologyMailPlusClient`, `apps/mailPlusClient/` | **Implemented** |
| **Mail** (legacy) | `SynologyMailClient`, `apps/mailClient/` (planned) | **Not implemented** |

Code and docs in this repo use the **`MailPlus` / `mailPlus` prefix** for the current app.
Synology's user API paths are still named `SYNO.MailClient.*` and the DSM login session is
`MailClient` — that is MailPlus's official WebAPI name, **not** the legacy Mail app.

## 1. Executive Summary

Synology MailPlus exposes two API packages on DSM:
- **`SYNO.MailPlusServer.*`** (66 APIs) — admin/management: Account, Domain, Security, Queue, Statistic, SMTP config... Only usable with an admin session (`MailPlusServer`); regular users typically get `error 402`.
- **`SYNO.MailClient.*`** (44 APIs) — user mail client: **Message v10, Thread v10, Mailbox v7, Draft v6, Attachment v8, Label v3, Filter v3, Signature v1, Setting.SMTP v2, Info v5...** This is the API set used by the n8n node (personal email operations).

**Node scope:** MailPlus user APIs (`SYNO.MailClient.*`) only — does not cover MailPlusServer admin or the legacy Synology Mail app.

## 2. Prerequisites

- The DSM user must have a **mail account enabled** in MailPlus Server (DSM → MailPlus Server → user → enable). If not enabled → all MailClient APIs return `error 402` (permission).
- Immediately after enabling, you may see `error 410` (database not ready) — wait a few seconds for `database_ready: true` (Info.getinfo).

## 3. Contract (verified live 2026-08-06)

- **Login session:** `MailClient` (not `MailPlus`/`MailPlusServer` — those sessions return 402).
- **Endpoint:** `POST /webapi/entry.cgi` (generic), form-urlencoded.
- **Auth:** `_sid` (or cookie) + `X-SYNO-TOKEN` header (login with `enable_syno_token=yes`).
- **Param encoding:** booleans/arrays/objects must be **JSON-encoded strings** in the form body (same as Note Station):
  - `conversation_view=true` (boolean string, NO quotes)
  - `condition=[{"name":"mailbox","value":"-1"}]` — **value is a STRING**
  - `additional=["blockquote","truncated"]`
  - `id=[1]` (JSON array) — not a bare number
- The UI calls some APIs via `SYNO.Entry.Request` compound requests, but **direct calls also work** (verified).

### Verified APIs
| API | Method | Params | Response |
|-----|--------|--------|----------|
| `Info` v5 | getinfo | — | `{database_ready, uid, compatibility_version}` |
| `Mailbox` v7 | list | subscription (bool), additional (array), conversation_view | `{mailbox: [{id, path, owner, subscribed, additional:{unread_count,total_count}}]}` |
| `Thread` v10 | list | condition=[{name:mailbox,value:"-1"}], offset, limit, additional, conversation_view, keyword? | `{total, thread:[{id, message:[{id, from, email, body_preview, arrival_time}], ...}]}` |
| `Message` v10 | get | id=[msgId] (JSON array), additional | `{message:[{id, from, subject, body:{html,plain}, to, cc, bcc, attachment}]}` |
| `Message` v10 | download_original | id (number) | **binary** RFC822 email |
| `Attachment` v8 | download | id | binary |
| `Label` v3 | list | additional, conversation_view | `{label:[], total}` |
| `Draft` v6 | create | **from (required)**, to/cc/bcc (array), subject, body, enable_read_request, enable_delivery_request | `{id, attachment:[], copied_attachment:[]}` |
| `Draft` v6 | send | id | `{id}` |
| `Thread` v10 | set_mailbox | id (array), **mailbox_id = destination**, **operate_mailbox_id = source**, conversation_view | success |
| `Thread` v10 | delete | id (array), mailbox_id (mailbox containing the thread), conversation_view | success |

### Mailbox ID mapping (built-in)
`-1`=inbox, `-2`=archived, `-3`=drafts, `-4`=sent, `-5`=spam, `-6`=trash, `-7`=scheduled

## 4. n8n Node — `Synology MailPlus` (`synologyMailPlusClient`)

Resources/operations:
- **MailPlus**: Get Info
- **Thread**: List (mailbox/limit/offset/keyword)
- **Message**: Get, Download Original (binary .eml), Download Attachment (binary)
- **Mailbox**: List
- **Label**: List
- **Draft**: Create (from/to/cc/bcc/subject/body), Send

Credential: reuse `synologyApi` (baseUrl/username/password). Session `MailClient` is set automatically in the client.

## 5. E2E (test/e2e-mailplusclient-n8n.js)

Workflow: Get Info → Mailboxes → Labels → Threads (inbox) → Message get → Draft create → Draft send. Live verification: database_ready, 7 mailboxes, threads with body_preview, message full content, draft created + sent (appears in Sent mailbox). Cleanup: delete test threads from inbox/sent (set_mailbox to trash then delete).

## 6. Operational Notes

- **Mail domain:** NAS uses `example.com` (postconf mydomain), maildir `/volume1/MailPlus/@local/<uid>/<uid>/Maildir`.
- **set_mailbox param order** is easy to confuse: `mailbox_id` = DESTINATION, `operate_mailbox_id` = SOURCE.
- `Message.download_original` and `Attachment.download` return binary — use `requestBinary` in transport.
- MailPlusServer admin APIs (66) are not covered — if needed later (account/domain/security administration), use a separate admin session.

## 7. Trigger — `Synology MailPlus Trigger` (`synologyMailPlusClientTrigger`)

Internal name must be `synologyMailPlusClientTrigger` so n8n merges trigger actions with
`synologyMailPlusClient` (strips trailing `Trigger` from the trigger name). Same pattern as
`telegram` + `telegramTrigger`, `synologyChat` + `synologyChatTrigger`.

Polling trigger in `nodes/SynologyMailPlusClient/` (same folder as the action node, like Synology Chat).
MailPlus has no webhook push — each poll calls `Thread.list` for the selected mailbox,
compares against `staticData`, and emits new threads.

Params (filters modeled after n8n core Gmail trigger):
- **Mailbox**: inbox/archived/drafts/sent/spam/trash/scheduled (default inbox)
- **Search Keyword**: filter threads by keyword (server-side)
- **From (Sender)**: only emit mail from sender — server-side via condition `from` (verified)
- **Unread Only** / **Read Status** (both/unread/read): client-side filter on `thread.unread`
- **Starred Only**: client-side on `thread.star`
- **Has Attachment Only**: client-side on `thread.has_attachment` / message.attachment
- **Label**: server-side condition `label` (uses **numeric label ID**, not name) — verified
- **Max Threads Per Poll**: default 50

Verified 2026-08-06 (E2E `test/e2e-mailplusclient-trigger-filters.js`): each filter emits the correct target mail —
from ✅, unreadOnly ✅, readStatus ✅, starredOnly ✅, hasAttachmentOnly ✅, label ✅.
**Bug fixed:** condition entries must be pushed before `JSON.stringify(condition)` (from/label are not sent if pushed after).
Label create: `background_color` + `text_color` = hex **without `#`** (e.g. `ff0000`). set_star: `star=1/0` (number).

Dedup note: static data (`mailPlusSeen_<mailbox>`) persists between polls when the workflow is ACTIVE.
Manual trigger runs in n8n do NOT share static data → each manual run treats all threads as new.

Output item: `{mailbox, mailboxId, thread, message, triggeredAt}`. Dedup via `getWorkflowStaticData('global')` key `mailPlusSeen_<mailbox>`.

Verified live 2026-08-06: send test email → poll emits new thread with correct subject (E2E `test/e2e-mailplusclient-trigger-n8n.js`).

## 8. Extended Operations (2026-08-06, all E2E verified live)

### Message
- Mark Read / Mark Unread: `Message.set_read` — `read` JSON-encoded boolean
- Star / Unstar: `Message.set_star` — `star` 1/0 (NUMBER)
- Move: `Message.set_mailbox` — `id` array + `mailbox_id`

### Thread
- Mark Read / Unread: `Thread.set_read` — `read` JSON bool + `conversation_view`
- Add / Remove Label: `Thread.add_label`/`remove_label` — `label_id` array
- Move: `Thread.set_mailbox` — `mailbox_id`=destination, `operate_mailbox_id`=source
- Delete: `Thread.delete` — `mailbox_id` (mailbox containing the thread)

### Label
- Create: `name` + `background_color` + `text_color` — **only accepts colors from a fixed palette** (uppercase hex without `#`):
  - bg: DCE1E6, FFCCCC, FFD9B2, FFEC8C, DDF29D, C4F5D4, C2F2F2, C8EDFA, CCE6FF, E2D9FF, FFD9F2, FFC0D2, 64696E, E04343, E67300, CCAA00, 739900, 009933, 009999, 008FBF, 1470CC, A18AE6, E67EC3, F56496
  - text: 50555A, C73232, BF6000, 997F00, 567300, 007326, 007373, 007399, 0059B3, 5536B3, B32483, A12A62, FFFFFF
- Update: `Label.set`; Delete: `Label.delete` (id array)

### Mailbox
- Create: `path`+`name`; Rename: `Mailbox.set`; Delete: `Mailbox.delete` (requires `conversation_view`)

### Draft
- Reply: create + `refer_to` + `draft_type=1`; Forward: `draft_type=2`
- Upload Attachment: `Attachment.upload` multipart (field `file`) — `id`=draftId, `filename` JSON-encoded
- Scheduled send: `schedule_time` (epoch seconds)

### Other
- Signature: list/create/delete (`is_default` JSON bool)
- Filter: list (rules); SMTP Account: list; MailTemplate: list; MailMerge: list
- Search: `Thread.list` + `keyword` top-level param (verified, no `is_search` needed)

### E2E test: test/e2e-mailplusclient-extended.js — all pass live, clean cleanup.
