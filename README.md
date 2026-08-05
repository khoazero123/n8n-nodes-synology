# n8n-nodes-synology

n8n community nodes for Synology NAS applications.

This package is designed as an umbrella package for multiple Synology apps. The first development target is **Synology Note Station**. Future targets include Drive, Download Station, File Station, Photos, and Calendar.

## Supported apps

### Synology Note Station

Initial development target:

- Shelf CRUD
- Notebook CRUD
- Note CRUD
- Native encrypted notes/notebooks, after API discovery
- Share support, including public share links
- Upload files to notes from n8n binary data

Current scaffold includes:

- Shared `Synology API` credential
- Shared DSM/WebAPI transport client
- `Synology Note Station` node skeleton
- Early notebook create, note create, and note get operations

### Synology Drive

Planned migration from: https://github.com/khoazero123/n8n-nodes-synology-drive

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
