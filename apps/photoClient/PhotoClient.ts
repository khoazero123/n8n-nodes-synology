import type { IDataObject } from 'n8n-workflow';
import {
	PHOTO_ALBUM_API,
	PHOTO_ALBUM_API_VERSION,
	PHOTO_CONDITION_ALBUM_API,
	PHOTO_CONDITION_ALBUM_API_VERSION,
	PHOTO_DOWNLOAD_API,
	PHOTO_DOWNLOAD_API_VERSION,
	PHOTO_FOLDER_API,
	PHOTO_FOLDER_API_VERSION,
	PHOTO_ITEM_API,
	PHOTO_ITEM_API_VERSION,
	PHOTO_NORMAL_ALBUM_API,
	PHOTO_NORMAL_ALBUM_API_VERSION,
	PHOTO_SEARCH_API,
	PHOTO_SEARCH_API_VERSION,
	PHOTO_SESSION,
	PHOTO_TEAM_FOLDER_API,
	PHOTO_TEAM_FOLDER_API_VERSION,
	PHOTO_TEAM_ITEM_API,
	PHOTO_THUMBNAIL_API,
	PHOTO_THUMBNAIL_API_VERSION,
} from './constants';
import type { GetItemInput, ListAlbumsInput, ListFoldersInput, ListItemsInput, PhotoAlbum, PhotoFolder, PhotoItem, SearchInput } from './types';
import type { SynologyClient } from '../../transport/SynologyClient';

/**
 * Synology Photos wrapper. Verified live on DSM 7 / Photos 1.9.1-10928
 * (2026-08-06).
 *
 * - Session: FileStation (Photos APIs accept it; session=Photos is not a
 *   valid DSM session name).
 * - All APIs served from /webapi/entry.cgi (NOT /photo/webapi/entry.cgi).
 * - Thumbnail/Download return raw binary — use requestBinary.
 * - Item.list additional: ["thumbnail","resolution","orientation"] returns
 *   cache_key per item (needed for thumbnail/download).
 */
export class PhotoClient {
	constructor(private readonly synology: SynologyClient) {}

	/** List all albums (normal + conditional). */
	async listAlbums(input: ListAlbumsInput = {}): Promise<PhotoAlbum[]> {
		const data = await this.synology.request<IDataObject>({
			api: PHOTO_ALBUM_API,
			version: PHOTO_ALBUM_API_VERSION,
			method: 'list',
			session: PHOTO_SESSION,
			params: { offset: input.offset ?? 0, limit: input.limit ?? 100 },
		}) as unknown as { list: PhotoAlbum[] };
		return data.list ?? [];
	}

	/** List normal (manual) albums only. */
	async listNormalAlbums(input: ListAlbumsInput = {}): Promise<PhotoAlbum[]> {
		const data = await this.synology.request<IDataObject>({
			api: PHOTO_NORMAL_ALBUM_API,
			version: PHOTO_NORMAL_ALBUM_API_VERSION,
			method: 'list',
			session: PHOTO_SESSION,
			params: { offset: input.offset ?? 0, limit: input.limit ?? 100 },
		}) as unknown as { list: PhotoAlbum[] };
		return data.list ?? [];
	}

	/** List conditional (auto/smart) albums only. */
	async listConditionAlbums(input: ListAlbumsInput = {}): Promise<PhotoAlbum[]> {
		const data = await this.synology.request<IDataObject>({
			api: PHOTO_CONDITION_ALBUM_API,
			version: PHOTO_CONDITION_ALBUM_API_VERSION,
			method: 'list',
			session: PHOTO_SESSION,
			params: { offset: input.offset ?? 0, limit: input.limit ?? 100 },
		}) as unknown as { list: PhotoAlbum[] };
		return data.list ?? [];
	}

	/** List folders in the Personal Space. */
	async listFolders(input: ListFoldersInput = {}): Promise<PhotoFolder[]> {
		const params: IDataObject = { offset: input.offset ?? 0, limit: input.limit ?? 100 };
		if (input.id !== undefined) params.id = input.id;
		const data = await this.synology.request<IDataObject>({
			api: PHOTO_FOLDER_API,
			version: PHOTO_FOLDER_API_VERSION,
			method: 'list',
			session: PHOTO_SESSION,
			params,
		}) as unknown as { list: PhotoFolder[] };
		return data.list ?? [];
	}

	/** List folders in the Shared Space. */
	async listTeamFolders(input: ListFoldersInput = {}): Promise<PhotoFolder[]> {
		const params: IDataObject = { offset: input.offset ?? 0, limit: input.limit ?? 100 };
		if (input.id !== undefined) params.id = input.id;
		const data = await this.synology.request<IDataObject>({
			api: PHOTO_TEAM_FOLDER_API,
			version: PHOTO_TEAM_FOLDER_API_VERSION,
			method: 'list',
			session: PHOTO_SESSION,
			params,
		}) as unknown as { list: PhotoFolder[] };
		return data.list ?? [];
	}

	/** List items in an album or folder. */
	async listItems(input: ListItemsInput): Promise<PhotoItem[]> {
		const params: IDataObject = { offset: input.offset ?? 0, limit: input.limit ?? 100 };
		if (input.albumId !== undefined) params.album_id = input.albumId;
		if (input.folderId !== undefined) params.folder_id = input.folderId;
		if (input.type && input.type !== 'all') params.type = input.type;
		if (input.additional) params.additional = JSON.stringify(input.additional);
		const api = input.team ? PHOTO_TEAM_ITEM_API : PHOTO_ITEM_API;
		const version = input.team ? 1 : PHOTO_ITEM_API_VERSION;
		const data = await this.synology.request<IDataObject>({
			api,
			version,
			method: 'list',
			session: PHOTO_SESSION,
			params,
		}) as unknown as { list: PhotoItem[] };
		return data.list ?? [];
	}

	/** Get a single item's details. */
	async getItem(input: GetItemInput): Promise<PhotoItem[]> {
		const params: IDataObject = { id: input.itemId };
		if (input.additional) params.additional = JSON.stringify(input.additional);
		const api = input.team ? PHOTO_TEAM_ITEM_API : PHOTO_ITEM_API;
		const version = input.team ? 1 : PHOTO_ITEM_API_VERSION;
		const data = await this.synology.request<IDataObject>({
			api,
			version,
			method: 'get',
			session: PHOTO_SESSION,
			params,
		}) as unknown as { list: PhotoItem[] };
		return data.list ?? [];
	}

	/** Search albums and items by keyword. */
	async search(input: SearchInput): Promise<IDataObject> {
		const params: IDataObject = {
			keyword: input.keyword,
			offset: input.offset ?? 0,
			limit: input.limit ?? 100,
			sort_by: 'takentime',
			sort_direction: 'desc',
		};
		return await this.synology.request({
			api: PHOTO_SEARCH_API,
			version: PHOTO_SEARCH_API_VERSION,
			method: 'search',
			session: PHOTO_SESSION,
			params,
		});
	}

	/** Get a thumbnail (binary). */
	async getThumbnail(itemId: number, cacheKey: string, size: 'sm' | 'm' | 'xl'): Promise<Buffer> {
		const response = await this.synology.requestBinary({
			api: PHOTO_THUMBNAIL_API,
			version: PHOTO_THUMBNAIL_API_VERSION,
			method: 'get',
			session: PHOTO_SESSION,
			params: { id: itemId, cache_key: cacheKey, type: 'unit', size },
		});
		return Buffer.from(response.body as ArrayBuffer);
	}

	/** Download the original file (binary). */
	async downloadOriginal(itemId: number, cacheKey: string): Promise<Buffer> {
		const response = await this.synology.requestBinary({
			api: PHOTO_DOWNLOAD_API,
			version: PHOTO_DOWNLOAD_API_VERSION,
			method: 'download',
			session: PHOTO_SESSION,
			params: { unit_id: JSON.stringify([itemId]), cache_key: cacheKey },
		});
		return Buffer.from(response.body as ArrayBuffer);
	}
}
