# n8n-nodes-synology

n8n community nodes for Synology NAS applications.

This package is designed as an umbrella package for multiple Synology apps. It currently includes **Synology Note Station** and **Synology Drive**. Future targets include Download Station, File Station, Photos, and Calendar.

## Supported apps

### Synology Note Station

Initial development target:

- Shelf CRUD
- Notebook CRUD
- Note CRUD
- Native encrypted notes/notebooks, after API discovery
- Share support, including public share links
- Upload files to notes from n8n binary data

Current implementation includes:

- Shared `Synology API` credential
- Shared DSM/WebAPI transport client
- `Synology Note Station` node
- Notebook, note, shelf/stack, and public-share operations
- User/group share operations, share-principal listing, Note Station info, and tag listing
- Full-note retrieval after note create/update when requested

Attachment upload/download/delete, note encryption, note versions, import/export, and recycle-bin restore are not exposed yet because their request/response contracts are not verified against the installed Note Station WebAPI.

### Synology Drive

Supported file operations:

- List files and folders
- Search by keyword
- List recently used items
- Create text files and folders
- Upload binary data
- Download files as n8n binary data
- Delete files or folders, with optional permanent deletion
- Get file or folder metadata
- Copy files or folders
- List Team Folders
- List, create, delete, and apply Labels
- Create public and advanced sharing links

Drive operations use Synology's Drive application API and DSM WebAPI endpoints exposed by Drive Server. Availability of Team Folders, Labels, advanced sharing, and some permissions depends on the installed Drive Server version and the user's permissions.

Drive uses the shared **Synology API** credential. Its application REST API uses a separate Drive session internally; the node handles that login and sends the required `id` and `did` cookies.

### Synology Download Station

- Create URL or magnet-link download tasks
- List and get task details
- Pause, resume, and delete tasks
- Get current download/upload statistics
- Get Download Station server configuration (read-only)
- Search BT search modules for a keyword (read-only)

The node currently uses the documented Download Station V1 APIs. Torrent-file upload and undocumented V2 create fallback remain pending contract verification.

## Credentials

Create a credential of type **Synology API**:

- NAS URL, for example `https://192.168.1.100:5001`
- DSM username
- DSM password
- Allow self-signed certificates, if needed

Each node chooses the correct Synology session internally. Note Station uses the `NoteStation` session.

## Development

```bash
npm install
npm run build
npm run lint
```

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the development plan.

## License

MIT
