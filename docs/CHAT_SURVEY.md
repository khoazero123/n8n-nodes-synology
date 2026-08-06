# Synology Chat — API Survey & Node Implementation (2026-08-06)

Verified live on DSM 7 / Chat **2.4.6-22200** (package `Chat`, webapi at
`/var/packages/Chat/target/webapi/`). Backend: PostgreSQL via pgbouncer
(database `synochat`, user `Chat`).

## Auth models

### 1. Session APIs (webhook/bot/channel/post management)
- Login `SYNO.API.Auth` session=`Chat` → `_sid` + `X-SYNO-TOKEN`.
- Used by: `SYNO.Chat.Webhook.Incoming`, `SYNO.Chat.Chatbot`,
  `SYNO.Chat.Bot`, `SYNO.Chat.Channel.*`, `SYNO.Chat.Post`.

### 2. External APIs (token-based, NO session)
- `SYNO.Chat.External.*` version 2. Token passed as form param.
- **`incoming`** — send message: `token` + `payload` (JSON string).
  Payload: `{text, file_url, user_ids, channel_ids, attachments}`.
  - Attachments (buttons): `attachments: [{callback_id, text, actions: [{type:"button", text, name, value, style}]}]`
  - Links: `<https://example.com|Click here>`
  - Max file upload 32 MB.
- **`channel_list`**, **`user_list`**, **`post_list`** (token + channel_id +
  prev_count/next_count/post_id), **`post_file_get`**.

## Incoming webhook lifecycle (IMPORTANT — verified)

Creating a webhook via API and sending with it requires **4 steps**:

1. `SYNO.Chat.Webhook.Incoming.create` (no params) → `{token, user_id}`.
   NOTE: the webhook is NOT bound to any channel yet.
2. `SYNO.Chat.Webhook.Incoming.set` `{user_id, channel_id}` — bind channel.
3. `SYNO.Chat.Bot.set` `{user_id, nickname}` — **REQUIRED**. Without a
   nickname the bot is **"not legal"** and `incoming` fails with
   error 404 "bot is not legal".
4. `SYNO.Chat.Bot.enable` `{user_id}` — activate.

Get token later: `SYNO.Chat.Webhook.Incoming.get` `{user_id}` (returns token).
Delete: `SYNO.Chat.Bot.delete` `{user_id, real_delete: true}`.

## Chatbot (max 5 per user)

- `SYNO.Chat.Chatbot.create` `{nickname}` → `{token, user_id}`.
- `SYNO.Chat.Chatbot.set` `{user_id, purpose, welcome_note, hide_from_user}`.
- `SYNO.Chat.Chatbot.get` `{user_id}` → includes token.
- Delete via `SYNO.Chat.Bot.delete`.

## Channels & Posts (session)

- `SYNO.Chat.Channel.list` v1 → `{channels: [{channel_id, name, type}]}`
  Types seen: public, private, anonymous, chatbot, synobot.
- `SYNO.Chat.Channel.get` v4 `{channel_id}`.
- `SYNO.Chat.Channel.Named.create` v1 `{name, member_ids}` (type param
  rejected with 407 — no 'type' field in create).
- `SYNO.Chat.Post.list` v2 `{channel_id, offset, limit}` → posts with
  `id`, `user_id`, `channel_id`, `message`, `create_at`, `post_id`.
- `SYNO.Chat.Post.delete` v2 `{post_id}` — fails with 415 "Post exceeds
  allowable delete time" for old posts (delete via SQL as fallback).

## Node: SynologyChat

Resources:
- **Message**: Send (webhook token), List Channels / Users / Posts (bot token)
- **Webhook**: Create / List / Get / Set / Delete
- **Chatbot**: Create / List / Get / Set / Delete
- **Channel**: List / Get / Create
- **Post**: List

E2E: `test/e2e-chat-n8n.js` — 8/8 pass live (create webhook → send → list
channels/posts → create/get/delete chatbot → cleanup). NAS verified clean
after test.

## Cleanup notes

- Test bots/webhooks deleted via `Bot.delete`.
- Orphan posts (deleted bot) can't be deleted via API → delete via SQL:
  `su -s /bin/sh Chat -c "psql -h /var/run/postgresql -d synochat -c 'DELETE FROM posts WHERE id IN (...)'"`
