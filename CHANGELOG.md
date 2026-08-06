# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
