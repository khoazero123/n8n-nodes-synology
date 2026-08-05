import type { IDataObject, IN8nHttpFullResponse } from 'n8n-workflow';
import {
	NOTE_API,
	NOTE_API_VERSION,
	NOTE_VERSION_API,
	NOTE_VERSION_API_VERSION,
	NOTE_ENCRYPT_API,
	NOTE_ENCRYPT_API_VERSION,
	EXPORT_NOTE_API,
	EXPORT_NOTEBOOK_API,
	EXPORT_WORD_API,
	EXPORT_API_VERSION,
	IMPORT_NOTEBOOK_API,
	IMPORT_ENEX_API,
	IMPORT_API_VERSION,
	NOTE_APPLINK_API,
	NOTE_APPLINK_API_VERSION,
	NOTE_STATION_SESSION,
	NOTEBOOK_API,
	NOTEBOOK_API_VERSION,
	PERMISSION_API,
	PERMISSION_API_VERSION,
	PUBLIC_PERMISSION_API,
	PUBLIC_PERMISSION_API_VERSION,
	SHARD_LINK_API,
	SHARD_LINK_API_VERSION,
	USER_PERMISSION_API,
	USER_PERMISSION_API_VERSION,
	GROUP_PERMISSION_API,
	GROUP_PERMISSION_API_VERSION,
	SHARE_PRIV_API,
	SHARE_PRIV_API_VERSION,
	TAG_API,
	TAG_API_VERSION,
	INFO_API,
	INFO_API_VERSION,
	STACK_API,
	STACK_API_VERSION,
} from './constants';
import type {
	CreateNotebookInput,
	CreateNoteInput,
	DeleteNotebookInput,
	DeleteNoteInput,
	DeletePublicShareInput,
	DeleteStackInput,
	GetPublicShareLinkInput,
	ListInput,
	NoteStationData,
	SetPublicShareInput,
	SetStackInput,
	SetIndividualShareInput,
	RemoveIndividualShareInput,
	UpdateNotebookInput,
	UpdateNoteInput,
	VersionInput,
	EncryptInput,
	ExportInput,
	ImportInput,
	AttachmentInput,
} from './types';
import type { SynologyClient } from '../../transport/SynologyClient';

function listParams(input: ListInput): IDataObject {
	const params: IDataObject = {};
	if (input.filter) params.filter = input.filter;
	if (input.field) params.field = input.field;
	if (input.offset !== undefined) params.offset = input.offset;
	if (input.limit !== undefined) params.limit = input.limit;
	if (input.sortBy) params.sort_by = input.sortBy;
	if (input.sortDirection) params.sort_direction = input.sortDirection;
	return params;
}

export class NoteStationClient {
	constructor(private readonly synology: SynologyClient) {}

	async listNotebooks(input: ListInput = {}): Promise<NoteStationData> {
		return await this.synology.request({
			api: NOTEBOOK_API,
			version: NOTEBOOK_API_VERSION,
			method: 'list',
			session: NOTE_STATION_SESSION,
			params: listParams(input),
		});
	}

	async getNotebook(objectId: string): Promise<NoteStationData> {
		return await this.synology.request({
			api: NOTEBOOK_API,
			version: NOTEBOOK_API_VERSION,
			method: 'get',
			session: NOTE_STATION_SESSION,
			params: { object_id: objectId },
		});
	}

	async createNotebook(input: CreateNotebookInput): Promise<NoteStationData> {
		return await this.synology.request({
			api: NOTEBOOK_API,
			version: NOTEBOOK_API_VERSION,
			method: 'create',
			session: NOTE_STATION_SESSION,
			params: {
				title: input.title,
				commit_msg: input.commitMessage ?? { device: 'n8n' },
			},
		});
	}

	async updateNotebook(input: UpdateNotebookInput): Promise<NoteStationData> {
		const params: IDataObject = {
			object_id: input.objectId,
			commit_msg: input.commitMessage ?? { device: 'n8n' },
		};
		if (input.title) params.title = input.title;
		if (input.stack) params.stack = input.stack;

		return await this.synology.request({
			api: NOTEBOOK_API,
			version: NOTEBOOK_API_VERSION,
			method: 'set',
			session: NOTE_STATION_SESSION,
			params,
		});
	}

	async deleteNotebook(input: DeleteNotebookInput): Promise<NoteStationData> {
		return await this.synology.request({
			api: NOTEBOOK_API,
			version: NOTEBOOK_API_VERSION,
			method: 'delete',
			session: NOTE_STATION_SESSION,
			params: {
				object_id: input.objectId,
				recursive: input.recursive ?? false,
			},
		});
	}

	async listNotes(input: ListInput = {}): Promise<NoteStationData> {
		return await this.synology.request({
			api: NOTE_API,
			version: NOTE_API_VERSION,
			method: 'list',
			session: NOTE_STATION_SESSION,
			params: listParams(input),
		});
	}

	async getNote(objectId: string): Promise<NoteStationData> {
		return await this.synology.request({
			api: NOTE_API,
			version: NOTE_API_VERSION,
			method: 'get',
			session: NOTE_STATION_SESSION,
			params: {
				object_id: objectId,
			},
		});
	}

	async createNote(input: CreateNoteInput): Promise<NoteStationData> {
		const params: IDataObject = {
			title: input.title,
			parent_id: input.parentId,
			encrypt: false,
			content: input.content,
			brief: input.brief ?? '',
			commit_msg: input.commitMessage ?? { device: 'n8n', listable: false },
		};

		return await this.synology.request({
			api: NOTE_API,
			version: NOTE_API_VERSION,
			method: 'create',
			session: NOTE_STATION_SESSION,
			params,
		});
	}

	async updateNote(input: UpdateNoteInput): Promise<NoteStationData> {
		const current = input.ver ? undefined : await this.getNote(input.objectId);
		const params: IDataObject = {
			object_id: input.objectId,
			ver: input.ver ?? current?.ver,
			commit_msg: input.commitMessage ?? { device: 'n8n', listable: false },
		};
		if (input.title !== undefined) params.title = input.title;
		if (input.parentId !== undefined) params.parent_id = input.parentId;
		if (input.content !== undefined) params.content = input.content;
		if (input.brief !== undefined) params.brief = input.brief;
		if (input.tags !== undefined) params.tag = input.tags;

		return await this.synology.request({
			api: NOTE_API,
			version: NOTE_API_VERSION,
			method: 'set',
			session: NOTE_STATION_SESSION,
			params,
		});
	}

	async appendNoteContent(objectId: string, extraContent: string, position: 'append' | 'prepend'): Promise<NoteStationData> {
		const current = await this.getNote(objectId);
		const currentContent = current.content as string ?? '';
		const content = position === 'append' ? currentContent + extraContent : extraContent + currentContent;
		return await this.updateNote({
			objectId,
			ver: current.ver as string | undefined,
			content,
		});
	}

	async deleteNote(input: DeleteNoteInput): Promise<NoteStationData> {
		return await this.synology.request({
			api: NOTE_API,
			version: NOTE_API_VERSION,
			method: 'delete',
			session: NOTE_STATION_SESSION,
			params: {
				object_id: input.objectId,
				recycle: input.recycle ?? true,
			},
		});
	}

	async restoreNote(objectId: string): Promise<NoteStationData> {
		return await this.synology.request({
			api: NOTE_API,
			version: NOTE_API_VERSION,
			method: 'restore',
			session: NOTE_STATION_SESSION,
			params: { object_id: objectId },
		});
	}

	async listVersions(input: VersionInput): Promise<NoteStationData> {
		return await this.synology.request({
			api: NOTE_VERSION_API,
			version: NOTE_VERSION_API_VERSION,
			method: 'list',
			session: NOTE_STATION_SESSION,
			params: { object_id: input.objectId },
		});
	}

	async getVersion(input: VersionInput): Promise<NoteStationData> {
		const params: IDataObject = { object_id: input.objectId };
		if (input.version) params.ver = input.version;
		return await this.synology.request({
			api: NOTE_VERSION_API,
			version: NOTE_VERSION_API_VERSION,
			method: 'get',
			session: NOTE_STATION_SESSION,
			params,
		});
	}

	async restoreVersion(input: VersionInput): Promise<NoteStationData> {
		return await this.synology.request({
			api: NOTE_VERSION_API,
			version: NOTE_VERSION_API_VERSION,
			method: 'restore',
			session: NOTE_STATION_SESSION,
			params: { object_id: input.objectId, ver: input.version }
		});
	}

	async createEncryptToken(input: EncryptInput): Promise<NoteStationData> {
		return await this.synology.request({
			api: NOTE_ENCRYPT_API,
			version: NOTE_ENCRYPT_API_VERSION,
			method: 'create',
			session: NOTE_STATION_SESSION,
			params: { object_id: input.objectId, password: input.password, duration: input.duration ?? 120 },
		});
	}

	async checkEncryptToken(input: EncryptInput): Promise<NoteStationData> {
		return await this.synology.request({
			api: NOTE_ENCRYPT_API,
			version: NOTE_ENCRYPT_API_VERSION,
			method: 'check',
			session: NOTE_STATION_SESSION,
			params: { object_id: input.objectId, token: input.token },
		});
	}

	async deleteEncryptToken(input: EncryptInput): Promise<NoteStationData> {
		return await this.synology.request({
			api: NOTE_ENCRYPT_API,
			version: NOTE_ENCRYPT_API_VERSION,
			method: 'delete',
			session: NOTE_STATION_SESSION,
			params: { object_id: input.objectId, token: input.token },
		});
	}

	async startExport(input: ExportInput, format: 'note' | 'word' | 'notebook'): Promise<NoteStationData> {
		const api = format === 'note' ? EXPORT_NOTE_API : format === 'word' ? EXPORT_WORD_API : EXPORT_NOTEBOOK_API;
		const params: IDataObject = { object_id: input.objectId };
		if (input.timezoneOffset !== undefined) params.timezone_offset = input.timezoneOffset;
		if (input.token) params.token = input.token;
		return await this.synology.request({ api, version: EXPORT_API_VERSION, method: 'start', session: NOTE_STATION_SESSION, params });
	}

	async exportStatus(taskId: string, format: 'note' | 'word' | 'notebook'): Promise<NoteStationData> {
		const api = format === 'note' ? EXPORT_NOTE_API : format === 'word' ? EXPORT_WORD_API : EXPORT_NOTEBOOK_API;
		return await this.synology.request({ api, version: EXPORT_API_VERSION, method: 'status', session: NOTE_STATION_SESSION, params: { task_id: taskId } });
	}

	async downloadExport(taskId: string, format: 'note' | 'word' | 'notebook'): Promise<IN8nHttpFullResponse> {
		const api = format === 'note' ? EXPORT_NOTE_API : format === 'word' ? EXPORT_WORD_API : EXPORT_NOTEBOOK_API;
		return await this.synology.requestBinary({ api, version: EXPORT_API_VERSION, method: 'download', session: NOTE_STATION_SESSION, params: { task_id: taskId, remove: true } });
	}

	async importFile(input: ImportInput, format: 'enex' | 'notebook'): Promise<NoteStationData> {
		const api = format === 'enex' ? IMPORT_ENEX_API : IMPORT_NOTEBOOK_API;
		return await this.synology.requestMultipart(
			{ api, version: IMPORT_API_VERSION, method: 'start', session: NOTE_STATION_SESSION },
			{ fieldName: input.filename, filename: input.filename, data: input.data, contentType: input.contentType },
			{ file: JSON.stringify([{ format: 'raw', name: input.filename }]) },
		);
	}

	async listAttachments(objectId: string): Promise<NoteStationData> {
		const note = await this.getNote(objectId);
		return { object_id: objectId, attachment: note.attachment ?? [] };
	}

	async uploadAttachment(input: AttachmentInput & { filename: string; data: Buffer; contentType?: string }): Promise<NoteStationData> {
		return await this.synology.requestMultipart(
			{ api: NOTE_API, version: NOTE_API_VERSION, method: 'set', session: NOTE_STATION_SESSION, params: { object_id: input.objectId, ver: input.version, attachment: [{ action: 'create', format: 'raw', name: input.filename }] } },
			{ fieldName: input.filename, filename: input.filename, data: input.data, contentType: input.contentType },
			{},
		);
	}

	async deleteAttachment(input: AttachmentInput): Promise<NoteStationData> {
		return await this.synology.request({ api: NOTE_API, version: NOTE_API_VERSION, method: 'set', session: NOTE_STATION_SESSION, params: { object_id: input.objectId, ver: input.version, attachment: [{ action: 'delete', file_id: input.fileId }] } });
	}

	async getAttachment(input: AttachmentInput): Promise<IN8nHttpFullResponse> {
		return await this.synology.requestBinary({
			api: NOTE_APPLINK_API,
			version: NOTE_APPLINK_API_VERSION,
			method: 'get',
			session: NOTE_STATION_SESSION,
			params: { object_id: input.objectId, ver: input.version, file_id: input.fileId, ...(input.token ? { token: input.token } : {}) },
		});
	}

	async setStack(input: SetStackInput): Promise<NoteStationData> {
		const params: IDataObject = { name: input.name };
		if (input.stackId) params.stack_id = input.stackId;

		return await this.synology.request({
			api: STACK_API,
			version: STACK_API_VERSION,
			method: 'set',
			session: NOTE_STATION_SESSION,
			params,
		});
	}

	async deleteStack(input: DeleteStackInput): Promise<NoteStationData> {
		return await this.synology.request({
			api: STACK_API,
			version: STACK_API_VERSION,
			method: 'delete',
			session: NOTE_STATION_SESSION,
			params: { stack_id: input.stackId },
		});
	}

	async setPublicShare(input: SetPublicShareInput): Promise<NoteStationData> {
		await this.synology.request({
			api: PERMISSION_API,
			version: PERMISSION_API_VERSION,
			method: 'set',
			session: NOTE_STATION_SESSION,
			params: { object_id: input.objectId, enabled: true },
		});

		return await this.synology.request({
			api: PUBLIC_PERMISSION_API,
			version: PUBLIC_PERMISSION_API_VERSION,
			method: 'set',
			session: NOTE_STATION_SESSION,
			params: { object_id: input.objectId, perm: input.permission },
		});
	}

	async deletePublicShare(input: DeletePublicShareInput): Promise<NoteStationData> {
		return await this.synology.request({
			api: PUBLIC_PERMISSION_API,
			version: PUBLIC_PERMISSION_API_VERSION,
			method: 'delete',
			session: NOTE_STATION_SESSION,
			params: { object_id: input.objectId },
		});
	}

	async getPublicShareLink(input: GetPublicShareLinkInput): Promise<NoteStationData> {
		return await this.synology.request({
			api: SHARD_LINK_API,
			version: SHARD_LINK_API_VERSION,
			method: 'get',
			session: NOTE_STATION_SESSION,
			params: { object_id: input.objectId, mode: input.mode ?? 'public' },
		});
	}

	async setUserShare(input: SetIndividualShareInput): Promise<NoteStationData> {
		await this.enablePermission(input.objectId);
		return await this.synology.request({
			api: USER_PERMISSION_API,
			version: USER_PERMISSION_API_VERSION,
			method: 'set',
			session: NOTE_STATION_SESSION,
			params: { object_id: input.objectId, username: input.name, perm: input.permission },
		});
	}

	async setGroupShare(input: SetIndividualShareInput): Promise<NoteStationData> {
		await this.enablePermission(input.objectId);
		return await this.synology.request({
			api: GROUP_PERMISSION_API,
			version: GROUP_PERMISSION_API_VERSION,
			method: 'set',
			session: NOTE_STATION_SESSION,
			params: { object_id: input.objectId, groupname: input.name, perm: input.permission },
		});
	}

	async removeUserShare(input: RemoveIndividualShareInput): Promise<NoteStationData> {
		return await this.synology.request({
			api: USER_PERMISSION_API,
			version: USER_PERMISSION_API_VERSION,
			method: 'delete',
			session: NOTE_STATION_SESSION,
			params: { object_id: input.objectId, username: input.name },
		});
	}

	async removeGroupShare(input: RemoveIndividualShareInput): Promise<NoteStationData> {
		return await this.synology.request({
			api: GROUP_PERMISSION_API,
			version: GROUP_PERMISSION_API_VERSION,
			method: 'delete',
			session: NOTE_STATION_SESSION,
			params: { object_id: input.objectId, groupname: input.name },
		});
	}

	async listShares(input: ListInput = {}): Promise<NoteStationData> {
		return await this.synology.request({
			api: SHARE_PRIV_API,
			version: SHARE_PRIV_API_VERSION,
			method: 'list',
			session: NOTE_STATION_SESSION,
			params: { query: '', ...listParams(input) },
		});
	}

	async listTags(input: ListInput = {}): Promise<NoteStationData> {
		return await this.synology.request({
			api: TAG_API,
			version: TAG_API_VERSION,
			method: 'list',
			session: NOTE_STATION_SESSION,
			params: listParams(input),
		});
	}

	async getInfo(): Promise<NoteStationData> {
		return await this.synology.request({
			api: INFO_API,
			version: INFO_API_VERSION,
			method: 'get',
			session: NOTE_STATION_SESSION,
		});
	}

	private async enablePermission(objectId: string): Promise<void> {
		await this.synology.request({
			api: PERMISSION_API,
			version: PERMISSION_API_VERSION,
			method: 'set',
			session: NOTE_STATION_SESSION,
			params: { object_id: objectId, enabled: true },
		});
	}
}
