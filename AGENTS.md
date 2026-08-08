# Agent guide

Instructions for AI agents and contributors working on this repository.

## Build and lint

```bash
npm install
npm run build
npm run lint
```

`npm run build` runs `n8n-node build` (TypeScript compile + static assets).

## E2E tests

E2E scripts live in `test/`. They are **not** npm scripts — run them directly.

### Prerequisites

- `npm run build` completed successfully
- A reachable Synology NAS with credentials in env:
  - `SYNO_BASE_URL`
  - `SYNO_ACCOUNT`
  - `SYNO_PASS`
- Optional: `SYNO_ALLOW_UNAUTHORIZED_CERTS=true` for self-signed certs
- Workflow tests that talk to n8n also need a running n8n instance and:
  - `N8N_BASE_URL` (default in scripts: `http://127.0.0.1:5681`)
  - `N8N_OWNER_EMAIL`
  - `N8N_OWNER_PASSWORD`

CI runs the full suite via [`.github/workflows/e2e.yml`](.github/workflows/e2e.yml) on a self-hosted runner with Docker n8n on port 5680.

### Direct API tests (no n8n)

| Test | Command | Node / layer |
|------|---------|--------------|
| Synology Drive API | `python3 test/e2e-drive-direct.py` | Drive REST transport |
| Download Station API | `python3 test/e2e-download-station-core.py` | DS WebAPI transport |
| Note Station API | `python3 test/e2e-note-station-core.py` | Note Station WebAPI transport |

### n8n workflow tests

| Test | Command | Coverage |
|------|---------|----------|
| Note Station (expanded) | `node test/e2e-n8n-notestation-expanded.js` | notebook/note/share/tag/info/version + get/update/list |
| Note Station (attachments) | `node test/e2e-n8n-notestation-attachments.js` | attachment upload/list/download/delete |
| Note Station (evaluation) | `node test/e2e-n8n-evaluation.js` | n8n evaluation trigger + basic note CRUD |
| Synology Drive | `node test/e2e-drive-n8n-workflow.js` | file CRUD, search, recent, download |
| Download Station | `node test/e2e-download-station-n8n.js` | info/config/statistics/tasks/BT search/edit (+ optional torrent) |
| MailPlus client | `node test/e2e-mailplusclient-n8n.js` | smoke chain + extended ops (thread/message/draft/signature/label/mailbox) |
| MailPlus trigger | `node test/e2e-mailplusclient-trigger-n8n.js` | activation, poll emission, filter matrix |
| Synology Chat (full node) | `node test/e2e-chat-n8n.js` | webhook, message, channel, chatbot |
| Chat outgoing webhook CRUD | `node test/e2e-chat-outgoing.js` | outgoingWebhook CRUD |
| Chat trigger | `node test/e2e-chat-trigger-n8n.js` | webhook trigger + filters |
| Chat encrypted channel | `node test/e2e-chat-encrypted.js` | channel.create (encrypted); NAS-specific |
| Synology Photos | `node test/e2e-photos-n8n.js` | album/folder/item list, thumbnail, download |

### CI subset (smoke suite)

Equivalent to the steps in `e2e.yml`:

```bash
python3 test/e2e-drive-direct.py
node test/e2e-drive-n8n-workflow.js
node test/e2e-n8n-notestation-expanded.js
node test/e2e-chat-outgoing.js
node test/e2e-chat-trigger-n8n.js
node test/e2e-mailplusclient-trigger-n8n.js
node test/e2e-mailplusclient-n8n.js
node test/e2e-n8n-notestation-attachments.js
node test/e2e-download-station-n8n.js
node test/e2e-photos-n8n.js
```

MailPlus trigger fixtures use the registrable domain from `SYNO_BASE_URL` (override with `SYNO_MAIL_DOMAIN`), inbox user from `SYNO_MAIL_USER` → `SYNO_ACCOUNT`; optional `SYNO_SMTP_HOST` when SMTP is not on the NAS hostname.

CI sets `SYNO_E2E_QUIET=true` so E2E scripts log only pass/fail lines (no mail content, NAS paths, or workflow payloads). Use `SYNO_E2E_VERBOSE=true` locally for full debug output.

### MailPlus filter fixtures

Set `SYNO_MAIL_FILTER_FIXTURES=true` when starred, attachment, and label fixtures exist on the target NAS.

### Operations not covered by E2E (intentional)

- Note Station: encryption, export/import, shelf, version restore (needs healthy Drive backend)
- Drive: labels, team folders, sharing, copy, upload multipart, getFileOrFolderInfo (legacy API; error 101 on some DSM builds)
- Download Station: pause/resume (destructive direct test only)
- MailPlus: message download/star/move, draft forward, mailbox rename
- Chat: incoming webhook in CI (covered by optional `e2e-chat-n8n.js`)
- Photos: `folder.listTeam` when shared space is disabled (skipped with Synology error 801)

## Mail vs MailPlus naming

Synology has two mail apps: **Mail** (legacy, not implemented) and **MailPlus** (implemented).
Use the `MailPlus` / `mailPlus` prefix in code (`apps/mailPlusClient/`, `SynologyMailPlusClient`,
`synologyMailPlusClient`). Synology's MailPlus user APIs are still named `SYNO.MailClient.*` in
DSM — that session name refers to MailPlus, not the legacy Mail app.

## Release

```bash
npm run release
```

Tags use the `v*.*.*` convention (e.g. `v0.1.6`, `v0.2.1-dev.0`). Publishing runs in GitHub Actions with npm provenance — see [`.github/workflows/publish.yml`](.github/workflows/publish.yml).

**Before creating or pushing any version tag**, `package.json` `version` must match the tag (strip the leading `v`). Example: tag `v0.2.1-dev.0` requires `"version": "0.2.1-dev.0"`. The Publish workflow fails at *Verify tag matches package version* if they differ. Commit the version bump (and changelog, when applicable) **before** tagging.

**Agents:** If the user asks to tag or push a release tag, always check `package.json` first. If the requested tag does not match the current version, **stop and tell the user** — do not tag or push until `package.json` is updated (unless they explicitly want a mismatched tag for a one-off experiment).

Do **not** bump `package.json` / CHANGELOG to a new version for fixes or updates if the current version is not yet published on npm. Keep working on the same version until it ships; only bump after that version is live on the registry.

### Changelog

Follow [Keep a Changelog](https://keepachangelog.com/). The `## [Unreleased]` heading is permanent — never delete it.

- While developing after a version is on npm: append notes under `[Unreleased]`.
- On release: move those notes into a new `## [x.y.z] - YYYY-MM-DD` section directly below `[Unreleased]`, leaving `[Unreleased]` empty (heading only).
- If the current `package.json` version is not on npm yet: put fix/update notes under that existing version section (do not invent a new version or leave them only in `[Unreleased]`).
- Document **user-facing / product** changes only. Do **not** mention CI/CD, GitHub Actions, E2E harnesses, test scripts, or internal workflow tooling in `CHANGELOG.md`.
