# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Synology Photos `SynologyPhotos` node (verified live on Photos 1.9.1):
  - Album: List / List Normal / List Conditional.
  - Folder: List Personal Space / List Shared Space.
  - Item: List (album/folder + type + thumbnail info), Get Thumbnail
    (binary), Download Original (binary).
- E2E `test/e2e-photos-n8n.js` 5/5 pass live. Docs `docs/PHOTOS_SURVEY.md`.

## [0.1.3] - 2026-08-06

### Fixed
- Bundle every node/credential file with esbuild so they are
  self-contained. n8n loads community nodes via `loadClassInIsolation`
  (VM) which cannot resolve relative requires to sibling dirs
  (`../../apps/`, `../../transport/`) — loading failed with "Cannot find
  module '../../apps/...'". Bundling inlines the shared client code into
  each node file; `n8n-workflow` stays external.

## [0.1.2] - 2026-08-06

### Fixed
- Node descriptions now use `inputs: ['main']` / `outputs: ['main']`
  string literals instead of `NodeConnectionTypes.Main` — the
  `NodeConnectionTypes` (plural) export does not exist in n8n-workflow
  2.32.x (`NodeConnectionType` singular is the current name), so package
  loading failed with "Class could not be found" when installed as a
  community node.
- `index.js` now re-exports all node/credential classes (n8n community
  package loader entry point).

## [0.1.1] - 2026-08-06

### Added
- Synology Chat `SynologyChat` node (verified live on DSM 7 / Chat 2.4.6):
  - Message: Send via webhook token (External API, no session), list
    channels/users/posts visible to a bot token.
  - Webhook (incoming): Create (4-step lifecycle: create → set channel →
    Bot.set nickname → enable), List, Get (returns token), Set, Delete.
  - Outgoing Webhook: Create (channel + trigger word + destination URL),
    List, Get, Set, Delete. Note: only fires for messages created via the
    real Chat client (UI/websocket), not REST API posts.
  - Chatbot: Create/List/Get/Set/Delete (max 5 per user).
  - Channel: List/Get/Create — encrypted channels supported
    (`type: private` + `encrypted: true`; requires the user to have an E2E
    keypair enabled in Chat UI).
  - Post: List.
- E2E suites: `test/e2e-chat-n8n.js` (8/8), `test/e2e-chat-encrypted.js`
  (3/3), `test/e2e-chat-outgoing.js` (5/5) — all pass live, NAS clean.

### Fixed
- Transport: outgoing webhook and channel-create research documented in
  `docs/CHAT_SURVEY.md` (keypair format, type=private requirement,
  n8n 2.33 webhook activation via CLI + restart).



### Added
- Synology MailPlus `SynologyMailClient`: 14 extended operations (all
  verified live via E2E against a DSM 7 NAS):
  - Message: Mark Read / Unread, Star / Unstar, Move.
  - Thread: Mark Read / Unread, Add / Remove Label, Move, Delete.
  - Label: Create / Update / Delete — colors restricted to the official
    palette (36 background + 13 text colors, uppercase hex without `#`).
  - Mailbox: Create / Rename / Delete.
  - Draft: Reply (`refer_to` + `draft_type=1`), Forward (`draft_type=2`),
    Attachment upload (multipart), Scheduled send (`schedule_time`).
  - Signature: List / Create / Delete.
  - Filter rules, SMTP accounts, MailTemplate, MailMerge: List.
  - Full-text search via `Thread.list` `keyword` parameter.
- New E2E suite `test/e2e-mailclient-extended.js` covering every new
  operation against a live NAS with full cleanup.

### Fixed
- Label color params now use the fixed MailPlus palette (arbitrary hex is
  rejected by the API with a type error).
- ID parameters accept numbers, comma-separated strings or arrays from
  expressions (`toIdArray` helper).
- Signature `is_default` is JSON-encoded as required by the API.
- E2E harness waits for execution persistence before reading results.

## [0.0.9] - 2026-08-06


### Added
- Download Station: V1→V2 URL create fallback (verified live on DSM 7).
- Download Station: new `Task List` resource — Get Files, Confirm Download,
  Get Download Status, Stop Download, Delete (full `create_list=true` flow).
- Download Station: `Edit` task operation (destination or priority).
- Download Station: `Download Source` operation (re-download original torrent
  binary via `SYNO.DownloadStation2.Task.Source`).
- Download Station E2E coverage for torrent upload, task-list flow, edit and
  source download against a live NAS.

### Fixed
- Transport: `X-SYNO-TOKEN` header now sent on every request (NAS returns
  error 105 for `_sid`-only requests on token-enabled sessions); session
  cache keeps `synotoken` alongside `sid`.

## [Unreleased]

### Added
- Expanded Note Station sharing with user/group grant and revoke operations.
- Added share-principal listing, tag listing, and Note Station info lookup.
- Expanded Synology Drive with file/folder metadata and copy operations.
- Added Team Folder listing.
- Added Label listing, creation, deletion, file-label management, and labelled-file listing.
- Added public-link and advanced-share creation operations.
- Documented Drive Server version and permission dependencies for these operations.

## [0.0.2] - 2025-08-19

### Added
- Initial Synology Drive community node for n8n
- Credential: `Synology Drive API` with login flow to obtain session cookie (`sid`)
- Resource: File
  - Get Files (list directory contents with sort, pagination, and optional filters)
  - Search (by keyword with sort and pagination)
  - List Items Recently Used
  - Create File Or Folder (supports text file content)
  - Upload (binary, multipart/form-data; conflict actions supported)
  - Download File (returns binary data; preserves filename and mime type)
  - Delete File Or Folder (soft or permanent)

### Notes
- Additional resources (File and Folder Sharing, Team Folder, Label) are scaffolded in the UI for future expansion.

---

## Previous Releases

For releases prior to v0.0.2, please refer to the git commit history.

## [0.0.8] - 2026-08-05

### Fixed
- Reused the Docker n8n runtime and a stable CI owner account for all n8n workflow E2E suites.

## [0.0.7] - 2026-08-05

### Fixed
- Made the Docker n8n E2E data directory writable by the container user in CI.

## [0.0.6] - 2026-08-05

### Fixed
- Alphabetized the Note Station resource selector so the community-node lint gate passes.
- Kept the expanded Note Station E2E harness Docker-only; it requires `N8N_BASE_URL` and never installs n8n on the host.

## [0.0.5] - 2026-08-05

### Changed
- Prepared the Docker-only expanded Note Station E2E harness and release workflow integration.

## [0.0.4] - 2026-08-05

### Fixed
- Removed the `form-data` runtime dependency. Multipart uploads are now built with standard Node.js `Buffer` and `crypto` primitives, satisfying the n8n community-package requirement of an empty `dependencies` field.
- Split Drive login into its own helper so requests no longer mix `getCredentials()` with manual `httpRequest()` calls.
- Added a credential test (`SYNO.API.Auth` login with `responseSuccessBody` validation) to the shared `Synology API` credential.
- Marked the `allowUnauthorizedCerts` credential field as password-masked to satisfy the sensitive-field lint rule.
- Added light/dark themed icons for the Drive and Note Station nodes and the shared credential.
- Alphabetized node option lists to pass the community-package lint rules.
- Set a valid `homepage` URL in `package.json`.

## [0.0.3] - 2026-08-05

### Added
- Integrated the Synology Drive node into the umbrella package.
- Reused the shared `Synology API` credential.
- Added Drive application-session authentication with `id` and `did` cookies.
- Registered Synology Drive in the package manifest alongside Note Station.
- Added direct Synology Drive REST API and n8n workflow E2E tests.
- Added a reusable GitHub Actions E2E workflow for manual runs and release gating.

### Changed
- Updated the E2E harness to install and manage a local n8n instance automatically.
- Configured the release workflow to publish only after the E2E gate succeeds.
