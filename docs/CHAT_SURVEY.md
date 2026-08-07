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

## Send as a normal user (NO webhook/bot) — verified 2026-08-07

Reverse-engineered from the web client (`synochat-common.js`, `Post_create`
map entry): the browser sends chat messages through the **session** API, not
webhook tokens. This lets the node send messages as the logged-in DSM user.

- **Channel post:** `SYNO.Chat.Post.create` **v5** with
  `{channel_id, type: "normal", message, conn_id, is_thread: 'false'}` →
  creates the post as the session user (response includes `post_id`,
  `creator_id`). Use string `"normal"` (not numeric `0`) — numeric `0` stores
  as a broken system post (invisible in UI, crashes open Chat tabs).
- **Direct message:** 1-to-1 chats are `type: "anonymous"` channels with
  exactly 2 members. Resolve the channel with
  `SYNO.Chat.Channel.Anonymous.initiate` **v2** `{user_ids: [<target>]}`
  (creates the DM channel if needed, returns the existing one otherwise),
  then `Post.create` into it.
  - Gotcha: passing `user_ids: [self]` (single) returns 400
    "you cannot talk to yourself"; passing the full member list
    `[self, other]` creates the channel (`[other, self]` order → 117
    "cannot join" — current user must be first).
- `conn_id` can be any unique string; it is used for encryption key routing
  and socket acks, not validated for plain-text posts.
- Post listing on v5 returns `message` (not `text`); `post_id` is the id
  column used by `Post.delete` v8.

## Node: SynologyChat

Resources:
- **Message**: Send a Message (as credential user to channel or DM)
- **Webhook**: Create / List / Get / Set / Delete
- **Chatbot**: Create / List / Get / Set / Delete
- **Channel**: List / Get / Create / List Posts / List Users

E2E: `test/e2e-chat-n8n.js` — 10/10 pass live (webhook create → **send message
to channel** → list channels/posts → **send message to user** → create/get/delete
chatbot → cleanup). NAS verified clean after test.

## Cleanup notes

- Test bots/webhooks deleted via `Bot.delete`.
- Orphan posts (deleted bot) can't be deleted via API → delete via SQL:
  `su -s /bin/sh Chat -c "psql -h /var/run/postgresql -d synochat -c 'DELETE FROM posts WHERE id IN (...)'"`

## Encrypted channels (2026-08-06, verified live)

**Confirmed working:** `Channel.Named.create {type: "private", name,
encrypted: true}` creates an E2E encrypted channel (verified: channels
with `encrypted = t` in DB, created both via API probe and the node).

### Key findings

- **`type` is REQUIRED** and must be `"private"` for encrypted channels.
  - `type: "public"` → **422 "public cannot encrypt"** — the server tries
    to encrypt the channel key for EVERY user, and most users have no E2E
    keypair.
  - `type: "private"` (no member_ids) → works; members are invited
    separately afterwards.
- **Do NOT pass `member_ids` on create** → error 119 (invalid). Frontend
  never passes members on create; it invites later.
- **Channel names cannot contain spaces** → 152 "record is not valid"
  (`regex.FullMatch` fails).
- The creating user MUST have an E2E keypair:
  - No keypair → **408 "keypair not exist"** (all channel creates fail).
  - Keypair is generated in the Chat web UI (Profile → Settings →
    Encryption): browser creates a curve25519 pair via libsodium
    `crypto_box_keypair`, stores `private_key_enc = base64(nonce +
    secretbox(base64(private_key), nonce, blake2b(password)))` via
    `SYNO.Chat.User.update_key`.
  - The stored `private_key_enc` may contain `\r\n` line wraps (64-char
    base64 wrap) — strip them before base64-decoding.
- Users with keypairs on this NAS (as of 2026-08-06): user 6, 16, and
  now user 10 (khoa) after enabling Encryption in the UI.
- Node `channel.create`: `type` (Private/Public, default Private) +
  `Encrypted Channel` checkbox. Members: invite separately (API not yet
  exposed).
- Reset keypair to empty: `SYNO.Chat.User.update_key {conn_id, public_key:
  "", private_key_enc: ""}` (returns success, restores original state).
- E2E: `test/e2e-chat-encrypted.js` — create encrypted channel via node,
  verify encrypted flag in DB, cleanup (SQL).

## Outgoing webhooks & Chat trigger (2026-08-06, verified live)

### Webhook.Outgoing API
- `SYNO.Chat.Webhook.Outgoing.create` (no params) → `{token, user_id}`.
- `Webhook.Outgoing.set {user_id, channel_id, trigger_word, url}` — bind
  channel + trigger word + destination URL. `channel_id: 0` = any channel
  (then trigger word required).
- `Bot.set {user_id, nickname}` + `Bot.enable` — same as incoming webhooks.
- `Webhook.Outgoing.list/get` — get returns token. Delete via `Bot.delete`.

### Trigger semantics (IMPORTANT)
- Outgoing webhook fires when a message **created through the real Chat
  client (UI / websocket)** matches: channel + message starts with
  `trigger_word` (or any message if no trigger word and channel set).
- **Messages created via REST API do NOT trigger outgoing webhooks**
  (verified: `Post.create` and `External.incoming` both posted successfully
  but the outgoing webhook never fired). This is a server-side design
  choice to avoid bot loops.
- Outgoing webhook POST payload: `token, channel_id, channel_name, user_id,
  username, post_id, timestamp, text, trigger_word`. Reply JSON body
  `{"text": "..."}` posts back into the channel.

### n8n integration (verified)
- n8n community nodes cannot register webhooks → use the core **Webhook
  Trigger** node to receive Chat outgoing webhooks.
- n8n 2.33: activating a webhook workflow via REST (`PATCH
  /rest/workflows/{id} {active:true}`) returns 200 but stays inactive.
  Use CLI + restart:
  ```
  docker exec n8n-dev n8n update:workflow --id <id> --active true
  docker restart n8n-dev
  ```
  After restart the webhook is registered and POSTs to
  `/webhook/<path>` return 200 "Workflow was started".
- For testing: the outgoing webhook URL must be reachable from the NAS
  (e.g. `http://10.10.20.104:5680/webhook/<path>` on this network).
