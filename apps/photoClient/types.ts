/** Types for the Synology Photos client. */

export interface PhotoAlbum {
	id: number;
	name: string;
	item_count?: number;
	owner_user_id?: number;
	passphrase?: string;
	shared?: boolean;
	[prop: string]: unknown;
}

export interface PhotoFolder {
	id: number;
	name: string;
	parent?: number;
	passphrase?: string;
	shared?: boolean;
	[prop: string]: unknown;
}

export interface PhotoItem {
	id: number;
	filename: string;
	filesize?: number;
	time?: number;
	indexed_time?: number;
	folder_id?: number;
	type?: string;
	additional?: {
		thumbnail?: {
			cache_key?: string;
			m?: string;
			sm?: string;
			xl?: string;
		};
		resolution?: { width?: number; height?: number };
		orientation?: number;
		[prop: string]: unknown;
	};
	[prop: string]: unknown;
}

export interface ListAlbumsInput {
	offset?: number;
	limit?: number;
}

export interface ListFoldersInput {
	offset?: number;
	limit?: number;
	id?: number;
}

export interface ListItemsInput {
	albumId?: number;
	folderId?: number;
	type?: 'photo' | 'video' | 'all';
	offset?: number;
	limit?: number;
	additional?: string[];
	team?: boolean;
}

export interface GetItemInput {
	itemId: number;
	additional?: string[];
	team?: boolean;
}

export interface SearchInput {
	keyword: string;
	offset?: number;
	limit?: number;
	team?: boolean;
}
