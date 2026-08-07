# MailPlus Node — Khảo Sát & Triển Khai

Ngày: 2026-08-06

## 1. Kết Luận Ngắn

Synology MailPlus có hai package API trên DSM:
- **`SYNO.MailPlusServer.*`** (66 APIs) — admin/management: Account, Domain, Security, Queue, Statistic, SMTP config... Chỉ dùng được với session admin (`MailPlusServer`), user thường bị `error 402`.
- **`SYNO.MailClient.*`** (44 APIs) — user mail client: **Message v10, Thread v10, Mailbox v7, Draft v6, Attachment v8, Label v3, Filter v3, Signature v1, Setting.SMTP v2, Info v5...** Đây là bộ API dùng cho n8n node (thao tác email cá nhân).

**Phạm vi node:** chỉ MailClient (theo yêu cầu boss — không cover MailPlusServer admin).

## 2. Yêu cầu tiên quyết

- User DSM phải được **kích hoạt mail account** trong MailPlus Server (DSM → MailPlus Server → user → enable). Chưa kích hoạt → mọi API MailClient trả `error 402` (permission).
- Ngay sau kích hoạt, có thể gặp `error 410` (database chưa ready) — đợi vài giây cho `database_ready: true` (Info.getinfo).

## 3. Contract (verified live 2026-08-06)

- **Login session:** `MailClient` (không phải `MailPlus`/`MailPlusServer` — các session đó 402).
- **Endpoint:** `POST /webapi/entry.cgi` (generic), form-urlencoded.
- **Auth:** `_sid` (hoặc cookie) + `X-SYNO-TOKEN` header (login với `enable_syno_token=yes`).
- **Encoding param:** boolean/array/object phải **JSON-encoded string** trong form (giống Note Station):
  - `conversation_view=true` (boolean string, KHÔNG quotes)
  - `condition=[{"name":"mailbox","value":"-1"}]` — **value là STRING**
  - `additional=["blockquote","truncated"]`
  - `id=[1]` (JSON array) — không phải số đơn
- UI gọi một số API qua `SYNO.Entry.Request` compound, nhưng **gọi trực tiếp cũng hoạt động** (verified).

### API đã verify
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
| `Thread` v10 | set_mailbox | id (array), **mailbox_id = đích**, **operate_mailbox_id = nguồn**, conversation_view | success |
| `Thread` v10 | delete | id (array), mailbox_id (mailbox chứa thread), conversation_view | success |

### Mailbox ID mapping (built-in)
`-1`=inbox, `-2`=archived, `-3`=drafts, `-4`=sent, `-5`=spam, `-6`=trash, `-7`=scheduled

## 4. Node n8n — `Synology MailPlus` (`synologyMailClient`)

Resources/operations:
- **Mail**: Get Info
- **Thread**: List (mailbox/limit/offset/keyword)
- **Message**: Get, Download Original (binary .eml), Download Attachment (binary)
- **Mailbox**: List
- **Label**: List
- **Draft**: Create (from/to/cc/bcc/subject/body), Send

Credential: reuse `synologyApi` (baseUrl/username/password). Session `MailClient` tự động trong client.

## 5. E2E (test/e2e-mailclient-n8n.js)

Workflow: Get Info → Mailboxes → Labels → Threads (inbox) → Message get → Draft create → Draft send. Verify live: database_ready, 7 mailboxes, threads có body_preview, message full content, draft created + sent (xuất hiện trong Sent mailbox). Cleanup: xóa thread test khỏi inbox/sent (set_mailbox tới trash rồi delete).

## 6. Lưu ý vận hành

- **Domain mail:** NAS dùng `megavn.net` (postconf mydomain), maildir `/volume1/MailPlus/@local/<uid>/<uid>/Maildir`.
- **set_mailbox param order** dễ nhầm: `mailbox_id` = ĐÍCH, `operate_mailbox_id` = NGUỒN.
- `Message.download_original` và `Attachment.download` trả binary — dùng `requestBinary` trong transport.
- MailPlusServer admin APIs (66) không cover — nếu cần sau này (quản trị account/domain/security) phải dùng session admin riêng.


## 7. Trigger — `Synology MailPlus Trigger` (`synologyMailClientTrigger`)

Internal name must be `synologyMailClientTrigger` so n8n merges trigger actions with
`synologyMailClient` (strips trailing `Trigger` from the trigger name). Same pattern as
`telegram` + `telegramTrigger`, `synologyChat` + `synologyChatTrigger`.

Polling trigger in `nodes/SynologyMailClient/` (same folder as the action node, like Synology Chat).
MailPlus has no webhook push — each poll calls `Thread.list` for the selected mailbox,
compares against `staticData`, and emits new threads.

Params (filters tham khảo Gmail trigger n8n core):
- **Mailbox**: inbox/archived/drafts/sent/spam/trash/scheduled (default inbox)
- **Search Keyword**: lọc thread theo keyword (server-side)
- **From (Sender)**: chỉ emit mail từ sender — server-side qua condition `from` (verified)
- **Unread Only** / **Read Status** (both/unread/read): client-side filter trên `thread.unread`
- **Starred Only**: client-side trên `thread.star`
- **Has Attachment Only**: client-side trên `thread.has_attachment` / message.attachment
- **Label**: server-side condition `label` (dùng **numeric label ID**, không phải tên) — verified
- **Max Threads Per Poll**: default 50

Verified 2026-08-06 (E2E `test/e2e-mailtrigger-filters.js`): mỗi filter emit đúng mail mục tiêu —
from ✅, unreadOnly ✅, readStatus ✅, starredOnly ✅, hasAttachmentOnly ✅, label ✅.
**Bug đã fix:** condition push phải trước `JSON.stringify(condition)` (from/label không được gửi nếu push sau).
Label create: `background_color` + `text_color` = hex **không có `#`** (vd `ff0000`). set_star: `star=1/0` (số).

Lưu ý dedup: static data (`mailSeen_<mailbox>`) persist giữa các poll khi workflow ACTIVE.
Manual trigger run trong n8n KHÔNG chia sẻ static data → mỗi manual run coi tất cả thread là mới.

Output item: `{mailbox, mailboxId, thread, message, triggeredAt}`. Dedup qua `getWorkflowStaticData('global')` key `mailSeen_<mailbox>`.

Verified live 2026-08-06: gửi email test → poll emit thread mới với subject đúng (E2E `test/e2e-mailtrigger-n8n.js`).


## 8. Extended Operations (2026-08-06, all E2E verified live)

### Message
- Mark Read / Mark Unread: `Message.set_read` — `read` JSON-encoded boolean
- Star / Unstar: `Message.set_star` — `star` 1/0 (SỐ)
- Move: `Message.set_mailbox` — `id` array + `mailbox_id`

### Thread
- Mark Read / Unread: `Thread.set_read` — `read` JSON bool + `conversation_view`
- Add / Remove Label: `Thread.add_label`/`remove_label` — `label_id` array
- Move: `Thread.set_mailbox` — `mailbox_id`=đích, `operate_mailbox_id`=nguồn
- Delete: `Thread.delete` — `mailbox_id` (mailbox chứa thread)

### Label
- Create: `name` + `background_color` + `text_color` — **chỉ chấp nhận màu trong palette cố định** (uppercase hex không `#`):
  - bg: DCE1E6, FFCCCC, FFD9B2, FFEC8C, DDF29D, C4F5D4, C2F2F2, C8EDFA, CCE6FF, E2D9FF, FFD9F2, FFC0D2, 64696E, E04343, E67300, CCAA00, 739900, 009933, 009999, 008FBF, 1470CC, A18AE6, E67EC3, F56496
  - text: 50555A, C73232, BF6000, 997F00, 567300, 007326, 007373, 007399, 0059B3, 5536B3, B32483, A12A62, FFFFFF
- Update: `Label.set`; Delete: `Label.delete` (id array)

### Mailbox
- Create: `path`+`name`; Rename: `Mailbox.set`; Delete: `Mailbox.delete` (cần `conversation_view`)

### Draft
- Reply: create + `refer_to` + `draft_type=1`; Forward: `draft_type=2`
- Upload Attachment: `Attachment.upload` multipart (field `file`) — `id`=draftId, `filename` JSON-encoded
- Scheduled send: `schedule_time` (epoch seconds)

### Khác
- Signature: list/create/delete (`is_default` JSON bool)
- Filter: list (rules); SMTP Account: list; MailTemplate: list; MailMerge: list
- Search: `Thread.list` + `keyword` top-level param (verified, không cần is_search)

### E2E test: test/e2e-mailclient-extended.js — tất cả pass live, cleanup sạch.
