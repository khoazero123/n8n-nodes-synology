import type { IDataObject } from 'n8n-workflow';
import {
	NOTE_API,
	NOTE_API_VERSION,
	NOTE_STATION_SESSION,
	NOTEBOOK_API,
	NOTEBOOK_API_VERSION,
	PERMISSION_API,
	PERMISSION_API_VERSION,
	PUBLIC_PERMISSION_API,
	PUBLIC_PERMISSION_API_VERSION,
	SHARD_LINK_API,
	SHARD_LINK_API_VERSION,
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
	UpdateNotebookInput,
	UpdateNoteInput,
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
}
