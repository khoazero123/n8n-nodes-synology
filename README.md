# n8n-nodes-synology

n8n community nodes for Synology NAS applications.

This package provides a shared **Synology API** credential and nodes for Synology Note Station, Drive, Download Station, MailPlus, Chat, and Photos.

## Supported nodes

### Synology Note Station

- Notebook, note, shelf/stack, and public-share operations
- User/group sharing and share-principal listing
- Note Station info and tag listing
- Optional full-note retrieval after note creation/update
- Upload files from n8n binary data

### Synology Drive

- List, search, create, upload, download, copy, and delete files/folders
- Recently used items and metadata
- Team Folders
- Labels: list, create, delete, and apply
- Public and advanced sharing links

Drive uses a separate Drive session internally and handles the required `id` and `did` cookies. Availability of some features depends on the installed Drive Server version and user permissions.

### Synology Download Station

- Create URL or magnet-link tasks
- List, inspect, pause, resume, and delete tasks
- Download/upload statistics and server configuration
- BT search modules
- Torrent-file upload through the verified Download Station frontend contract

### Synology MailPlus

`Synology MailPlus` provides MailPlus operations through the regular node. `Synology MailPlus Trigger` is a polling trigger for new mailbox threads.

Trigger options include:

- Mailbox
- Search keyword
- Sender (`From`)
- Unread-only mode
- Read status: both, unread, or read
- Starred-only mode
- Has-attachment-only mode
- Label name or ID
- Maximum threads per poll

The trigger tracks previously seen thread IDs in workflow static data and emits matching threads with mailbox metadata, thread data, and messages.

### Synology Chat

`Synology Chat` supports:

- **Send a Message** as the credential DSM user to a channel or direct message
  (session `Post.create` — same as the web client, no webhook/bot)
- List channels, users, and posts (via bot token for external API reads)
- Manage incoming webhooks, chatbots, and channels
- Manage outgoing webhooks

`Synology Chat Trigger` receives Synology Chat outgoing-webhook requests over an n8n webhook. When the workflow is activated, it creates and manages the corresponding Synology Chat outgoing webhook automatically.

Trigger options include:

- Channel ID, or any channel when set to `0`
- Trigger word prefix
- Outgoing-webhook nickname

Only matching messages are emitted to the workflow. The incoming Chat webhook payload is passed through unchanged.

### Synology Photos

Photo operations are available through the `Synology Photos` node. Availability depends on the installed Synology Photos version and account permissions.

## Credentials

Create a credential of type **Synology API**:

- NAS URL, for example `https://192.168.1.100:5001`
- DSM username
- DSM password
- Whether self-signed TLS certificates are allowed

Each node selects the required Synology application session internally. Note Station uses the `NoteStation` session; Drive and MailPlus use their respective application APIs.

## Development

```bash
npm install
npm run build
npm run lint
```

### E2E tests

The E2E tests require a running n8n instance. Tests that call the Synology NAS use the shared environment variables `SYNO_BASE_URL`, `SYNO_ACCOUNT`, and `SYNO_PASS`; these are not MailPlus-specific.

Available trigger tests include:

```bash
npm run test:e2e:chat:outgoing
npm run test:e2e:chat:trigger
npm run test:e2e:mail:trigger
npm run test:e2e:mail:filters
```

The Chat trigger test covers activation, outgoing-webhook registration, channel filtering, trigger-word filtering, and payload delivery. MailPlus tests cover trigger polling and deterministic sender/read-status filters. Starred, attachment, and label fixtures can be enabled with `SYNO_MAIL_FILTER_FIXTURES=true` when those fixtures exist on the target NAS.

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the development plan.

## License

MIT
