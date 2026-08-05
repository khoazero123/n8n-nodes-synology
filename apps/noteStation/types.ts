import type { IDataObject } from 'n8n-workflow';

export interface ListInput {
	filter?: IDataObject;
	field?: IDataObject;
	offset?: number;
	limit?: number;
	sortBy?: string;
	sortDirection?: string;
}

export interface CreateNotebookInput {
	title: string;
	commitMessage?: IDataObject;
}

export interface UpdateNotebookInput {
	objectId: string;
	title?: string;
	stack?: string;
	commitMessage?: IDataObject;
}

export interface DeleteNotebookInput {
	objectId: string;
	recursive?: boolean;
}

export interface CreateNoteInput {
	title: string;
	parentId: string;
	content: string;
	brief?: string;
	commitMessage?: IDataObject;
}

export interface UpdateNoteInput {
	objectId: string;
	ver?: string;
	title?: string;
	parentId?: string;
	content?: string;
	brief?: string;
	tags?: string[];
	commitMessage?: IDataObject;
}

export interface DeleteNoteInput {
	objectId: string;
	recycle?: boolean;
}

export interface SetStackInput {
	stackId?: string;
	name: string;
}

export interface DeleteStackInput {
	stackId: string;
}

export interface SetPublicShareInput {
	objectId: string;
	permission: 'ro' | 'rw';
}

export interface DeletePublicShareInput {
	objectId: string;
}

export interface GetPublicShareLinkInput {
	objectId: string;
	mode?: string;
}

export type NoteStationData = IDataObject;
