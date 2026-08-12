/** Synology Chat API constants. Verified live on DSM 7 / Chat 2.4.6-22200 (2026-08-06). */

/** DSM session name for Chat. */
export const CHAT_SESSION = 'Chat';

/** API namespaces used by the Chat package (webapi/entry.cgi). */
export const CHAT_EXTERNAL_API = 'SYNO.Chat.External';
export const CHAT_WEBHOOK_INCOMING_API = 'SYNO.Chat.Webhook.Incoming';
export const CHAT_WEBHOOK_OUTGOING_API = 'SYNO.Chat.Webhook.Outgoing';
export const CHAT_CHATBOT_API = 'SYNO.Chat.Chatbot';
export const CHAT_BOT_API = 'SYNO.Chat.Bot';
export const CHAT_CHANNEL_API = 'SYNO.Chat.Channel';
export const CHAT_CHANNEL_NAMED_API = 'SYNO.Chat.Channel.Named';
export const CHAT_CHANNEL_ANONYMOUS_API = 'SYNO.Chat.Channel.Anonymous';
export const CHAT_POST_API = 'SYNO.Chat.Post';

/** External API (token-based, no session) uses version 2. */
export const CHAT_EXTERNAL_API_VERSION = 2;
/** Webhook / bot management APIs use version 1. */
export const CHAT_WEBHOOK_API_VERSION = 1;
export const CHAT_CHATBOT_API_VERSION = 1;
export const CHAT_BOT_API_VERSION = 1;
export const CHAT_CHANNEL_API_VERSION = 1;
export const CHAT_CHANNEL_ANONYMOUS_API_VERSION = 2;
/** Post APIs (session) use version 5. create/send verified 2026-08-07. */
export const CHAT_POST_API_VERSION = 5;
/** Post.delete uses a higher version (v8, verified 2026-08-11). */
export const CHAT_POST_DELETE_API_VERSION = 8;
