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
- Full-note retrieval after note create/update when requested

### Synology Drive

Supported file operations:

- List files and folders
- Search by keyword
- List recently used items
- Create text files and folders
- Upload binary data
- Download files as n8n binary data
- Delete files or folders, with optional permanent deletion

Drive uses the shared **Synology API** credential. Its application REST API uses a separate Drive session internally; the node handles that login and sends the required `id` and `did` cookies.

### Synology Download Station

Planned.

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
