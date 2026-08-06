/** Synology Photos API constants. Verified live on DSM 7 / Photos 1.9.1-10928 (2026-08-06). */

/** DSM session used by Photos APIs (verified: FileStation session works). */
export const PHOTO_SESSION = 'FileStation';

/** API namespaces (all served from /webapi/entry.cgi). */
export const PHOTO_ALBUM_API = 'SYNO.Foto.Browse.Album';
export const PHOTO_NORMAL_ALBUM_API = 'SYNO.Foto.Browse.NormalAlbum';
export const PHOTO_CONDITION_ALBUM_API = 'SYNO.Foto.Browse.ConditionAlbum';
export const PHOTO_FOLDER_API = 'SYNO.Foto.Browse.Folder';
export const PHOTO_ITEM_API = 'SYNO.Foto.Browse.Item';
export const PHOTO_THUMBNAIL_API = 'SYNO.Foto.Thumbnail';
export const PHOTO_DOWNLOAD_API = 'SYNO.Foto.Download';
export const PHOTO_SEARCH_API = 'SYNO.Foto.Search.Search';
export const PHOTO_SEARCH_FILTER_API = 'SYNO.Foto.Search.Filter';
export const PHOTO_TEAM_FOLDER_API = 'SYNO.FotoTeam.Browse.Folder';
export const PHOTO_TEAM_ITEM_API = 'SYNO.FotoTeam.Browse.Item';

/** Max versions from SYNO.API.Info (live query). */
export const PHOTO_ALBUM_API_VERSION = 5;
export const PHOTO_NORMAL_ALBUM_API_VERSION = 1;
export const PHOTO_CONDITION_ALBUM_API_VERSION = 1;
export const PHOTO_FOLDER_API_VERSION = 2;
export const PHOTO_ITEM_API_VERSION = 7;
export const PHOTO_THUMBNAIL_API_VERSION = 1;
export const PHOTO_DOWNLOAD_API_VERSION = 1;
export const PHOTO_SEARCH_API_VERSION = 1;
export const PHOTO_SEARCH_FILTER_API_VERSION = 1;
export const PHOTO_TEAM_FOLDER_API_VERSION = 2;
export const PHOTO_TEAM_ITEM_API_VERSION = 1;
