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

| Test | Command |
|------|---------|
| Synology Drive API | `python3 test/e2e-drive-direct.py` |
| Download Station API | `python3 test/e2e-download-station-core.py` |

### n8n workflow tests

| Test | Command |
|------|---------|
| Note Station (basic) | `node test/e2e-n8n-workflow.js` |
| Note Station (expanded) | `node test/e2e-n8n-notestation-expanded.js` |
| Note Station (attachments) | `node test/e2e-n8n-notestation-attachments.js` |
| Note Station (evaluation) | `node test/e2e-n8n-evaluation.js` |
| Synology Drive | `node test/e2e-drive-n8n-workflow.js` |
| Download Station | `node test/e2e-download-station-n8n.js` |
| MailPlus client | `node test/e2e-mailplusclient-n8n.js` |
| MailPlus client (extended) | `node test/e2e-mailplusclient-extended.js` |
| MailPlus trigger | `node test/e2e-mailplusclient-trigger-n8n.js` |
| MailPlus trigger filters | `node test/e2e-mailplusclient-trigger-filters.js` |
| Synology Chat (optional, full node) | `node test/e2e-chat-n8n.js` |
| Chat outgoing webhook CRUD | `node test/e2e-chat-outgoing.js` |
| Chat trigger | `node test/e2e-chat-trigger-n8n.js` |
| Synology Photos | `node test/e2e-photos-n8n.js` |

### CI subset (smoke suite)

Equivalent to the steps in `e2e.yml`:

```bash
python3 test/e2e-drive-direct.py
node test/e2e-drive-n8n-workflow.js
node test/e2e-n8n-workflow.js
node test/e2e-n8n-notestation-expanded.js
node test/e2e-chat-outgoing.js
node test/e2e-chat-trigger-n8n.js
node test/e2e-download-station-n8n.js
```

Optional (when `SYNO_NOTE_ATTACHMENT_E2E=true` in CI):

```bash
node test/e2e-n8n-notestation-attachments.js
```

Optional (when `SYNO_MAIL_SMTP_E2E=true` in CI; needs reachable SMTP — `SYNO_SMTP_HOST` / hostname of `SYNO_BASE_URL`):

```bash
node test/e2e-mailplusclient-trigger-n8n.js
node test/e2e-mailplusclient-trigger-filters.js
```

### MailPlus filter fixtures

Set `SYNO_MAIL_FILTER_FIXTURES=true` when starred, attachment, and label fixtures exist on the target NAS.

## Mail vs MailPlus naming

Synology has two mail apps: **Mail** (legacy, not implemented) and **MailPlus** (implemented).
Use the `MailPlus` / `mailPlus` prefix in code (`apps/mailPlusClient/`, `SynologyMailPlusClient`,
`synologyMailPlusClient`). Synology's MailPlus user APIs are still named `SYNO.MailClient.*` in
DSM — that session name refers to MailPlus, not the legacy Mail app.

## Release

```bash
npm run release
```

Tags use the `v*.*.*` convention (e.g. `v0.1.6`). Publishing runs in GitHub Actions with npm provenance — see [`.github/workflows/publish.yml`](.github/workflows/publish.yml).

Do **not** bump `package.json` / CHANGELOG to a new version for fixes or updates if the current version is not yet published on npm. Keep working on the same version until it ships; only bump after that version is live on the registry.

### Changelog

Follow [Keep a Changelog](https://keepachangelog.com/). The `## [Unreleased]` heading is permanent — never delete it.

- While developing after a version is on npm: append notes under `[Unreleased]`.
- On release: move those notes into a new `## [x.y.z] - YYYY-MM-DD` section directly below `[Unreleased]`, leaving `[Unreleased]` empty (heading only).
- If the current `package.json` version is not on npm yet: put fix/update notes under that existing version section (do not invent a new version or leave them only in `[Unreleased]`).
- Document **user-facing / product** changes only. Do **not** mention CI/CD, GitHub Actions, E2E harnesses, test scripts, or internal workflow tooling in `CHANGELOG.md`.
