import type {
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import { MailClientClient } from '../../apps/mailClient/MailClientClient';
import { MAILBOX_ID_MAP } from '../../apps/mailClient/constants';
import { SynologyClient } from '../../transport/SynologyClient';
import type { SynologyCredentials } from '../../transport/types';

/**
 * Polls a MailPlus mailbox and emits new threads since the last poll.
 * Uses MailClient APIs (session=MailClient). Requires the DSM user to have
 * a MailPlus mail account enabled.
 */
export class SynologyMailTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Synology MailPlus Trigger',
		name: 'synologyMailTrigger',
		icon: { light: 'file:SynologyMailClient.svg', dark: 'file:SynologyMailClient-dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{ $parameter["mailbox"] + " mailbox" }}',
		description: 'Triggers when new email arrives in a Synology MailPlus mailbox',
		defaults: { name: 'Synology MailPlus Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'synologyApi', required: true }],
		polling: true,
		properties: [
			{
				displayName: 'Mailbox',
				name: 'mailbox',
				type: 'options',
				options: [
					{ name: 'Inbox', value: 'inbox' },
					{ name: 'Archived', value: 'archived' },
					{ name: 'Drafts', value: 'drafts' },
					{ name: 'Sent', value: 'sent' },
					{ name: 'Spam', value: 'spam' },
					{ name: 'Trash', value: 'trash' },
					{ name: 'Scheduled', value: 'scheduled' },
				],
				default: 'inbox',
			},
			{
				displayName: 'Search Keyword',
				name: 'keyword',
				type: 'string',
				default: '',
				description: 'Optional keyword filter — only emit threads matching it',
			},
			{
				displayName: 'From (Sender)',
				name: 'from',
				type: 'string',
				default: '',
				description: 'Only emit emails from this sender address (server-side filter)',
			},
			{
				displayName: 'Unread Only',
				name: 'unreadOnly',
				type: 'boolean',
				default: false,
				description: 'Whether to only emit unread emails (client-side filter on thread.unread)',
			},
			{
				displayName: 'Read Status',
				name: 'readStatus',
				type: 'options',
				options: [
					{ name: 'Both', value: 'both' },
					{ name: 'Unread', value: 'unread' },
					{ name: 'Read', value: 'read' },
				],
				default: 'both',
				description: 'Filter by read status (client-side filter on thread.unread)',
			},
			{
				displayName: 'Starred Only',
				name: 'starredOnly',
				type: 'boolean',
				default: false,
				description: 'Whether to only emit starred emails',
			},
			{
				displayName: 'Has Attachment Only',
				name: 'hasAttachmentOnly',
				type: 'boolean',
				default: false,
				description: 'Whether to only emit emails with attachments',
			},
			{
				displayName: 'Label',
				name: 'label',
				type: 'string',
				default: '',
				description: 'Only emit emails with this label (label name or numeric ID)',
			},
			{
				displayName: 'Max Threads Per Poll',
				name: 'maxThreads',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 50,
				description: 'Max number of threads to check per poll',
			},
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const credentials = await this.getCredentials('synologyApi') as unknown as SynologyCredentials;
		const mc = new MailClientClient(new SynologyClient(this as never, credentials));

		const mailbox = this.getNodeParameter('mailbox', 'inbox') as string;
		const keyword = this.getNodeParameter('keyword', '') as string;
		const from = this.getNodeParameter('from', '') as string;
		const label = this.getNodeParameter('label', '') as string;
		const unreadOnly = this.getNodeParameter('unreadOnly', false) as boolean;
		const readStatus = this.getNodeParameter('readStatus', 'both') as string;
		const starredOnly = this.getNodeParameter('starredOnly', false) as boolean;
		const hasAttachmentOnly = this.getNodeParameter('hasAttachmentOnly', false) as boolean;
		const maxThreads = this.getNodeParameter('maxThreads', 50) as number;
		const mailboxId = MAILBOX_ID_MAP[mailbox];

		const threads = await mc.listThreads({
			mailboxId,
			offset: 0,
			limit: maxThreads,
			keyword: keyword || undefined,
			from: from || undefined,
			label: label || undefined,
		});

		const staticData = this.getWorkflowStaticData('global');
		const seenKey = `mailSeen_${mailbox}`;
		const seenIds = new Set<number>(Array.isArray(staticData[seenKey]) ? staticData[seenKey] as number[] : []);
		const now = Date.now();

		// Client-side filters: unread/read status, starred, has attachment
		const toBool = (v: unknown): boolean => v === 1 || v === true || v === '1' || v === 'true';
		const filterRead = (unread: unknown): boolean => {
			if (readStatus === 'both' && !unreadOnly) return true;
			const isUnread = toBool(unread);
			if (unreadOnly || readStatus === 'unread') return isUnread;
			if (readStatus === 'read') return !isUnread;
			return true;
		};
		const filterStarred = (thread: { star?: unknown; starred?: unknown }): boolean => {
			if (!starredOnly) return true;
			return toBool(thread.star) || toBool(thread.starred);
		};
		const filterAttachment = (thread: { message?: Array<{ attachment?: unknown }>; has_attachment?: unknown }): boolean => {
			if (!hasAttachmentOnly) return true;
			if (toBool(thread.has_attachment)) return true;
			return (thread.message ?? []).some((m) => Array.isArray(m.attachment) && m.attachment.length > 0);
		};

		// New threads = not in seen set, matching read filters. Sort newest first, cap by limit.
		const newThreads = (threads.thread ?? [])
			.filter((t) => !seenIds.has(t.id))
			.filter((t) => filterRead(t.unread))
			.filter((t) => filterStarred(t as never))
			.filter((t) => filterAttachment(t as never))
			.slice(0, maxThreads);

		// Persist all current thread ids so they are not re-emitted next poll.
		staticData[seenKey] = [...new Set([...(threads.thread ?? []).map((t) => t.id)])];
		staticData[`mailSeenAt_${mailbox}`] = now;

		if (newThreads.length === 0) {
			return null;
		}

		const items: INodeExecutionData[] = newThreads.map((thread) => ({
			json: {
				mailbox,
				mailboxId,
				thread,
				message: thread.message ?? [],
				triggeredAt: now,
			} as unknown as IDataObject,
		}));

		return [items];
	}
}
