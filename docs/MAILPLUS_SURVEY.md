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


## 7. Trigger Node — `Synology MailTrigger` (`synologyMailTrigger`)

Polling trigger (MailPlus không có webhook push). Mỗi poll gọi `Thread.list` cho mailbox chọn, so với `staticData` (thread ids đã thấy), emit các thread mới.

Params:
- **Mailbox**: inbox/archived/drafts/sent/spam/trash/scheduled (default inbox)
- **Search Keyword**: lọc thread theo keyword
- **Max Threads Per Poll**: default 50

Output item: `{mailbox, mailboxId, thread, message, triggeredAt}`. Dedup qua `getWorkflowStaticData('global')` key `mailSeen_<mailbox>`.

Verified live 2026-08-06: gửi email test → poll emit thread mới với subject đúng (E2E `test/e2e-mailtrigger-n8n.js`).
