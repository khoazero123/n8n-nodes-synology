import type { IDataObject, INodeExecutionData } from 'n8n-workflow';
import type { MailClientClient } from './MailClientClient';
import { MAILBOX_ID_MAP } from './constants';

export interface MailPollInput {
	mailbox: string;
	keyword?: string;
	from?: string;
	label?: string;
	unreadOnly: boolean;
	readStatus: string;
	starredOnly: boolean;
	hasAttachmentOnly: boolean;
	maxThreads: number;
}

/** Poll mailbox threads and return new items since the last poll (staticData dedup). */
export async function pollNewMailThreads(
	mc: MailClientClient,
	staticData: IDataObject,
	input: MailPollInput,
): Promise<INodeExecutionData[] | null> {
	const mailbox = input.mailbox;
	const mailboxId = MAILBOX_ID_MAP[mailbox];
	const threads = await mc.listThreads({
		mailboxId,
		offset: 0,
		limit: input.maxThreads,
		keyword: input.keyword || undefined,
		from: input.from || undefined,
		label: input.label || undefined,
	});

	const seenKey = `mailSeen_${mailbox}`;
	const seenIds = new Set<number>(Array.isArray(staticData[seenKey]) ? staticData[seenKey] as number[] : []);
	const now = Date.now();

	const toBool = (v: unknown): boolean => v === 1 || v === true || v === '1' || v === 'true';
	const filterRead = (unread: unknown): boolean => {
		if (input.readStatus === 'both' && !input.unreadOnly) return true;
		const isUnread = toBool(unread);
		if (input.unreadOnly || input.readStatus === 'unread') return isUnread;
		if (input.readStatus === 'read') return !isUnread;
		return true;
	};
	const filterStarred = (thread: { star?: unknown; starred?: unknown }): boolean => {
		if (!input.starredOnly) return true;
		return toBool(thread.star) || toBool(thread.starred);
	};
	const filterAttachment = (thread: { message?: Array<{ attachment?: unknown }>; has_attachment?: unknown }): boolean => {
		if (!input.hasAttachmentOnly) return true;
		if (toBool(thread.has_attachment)) return true;
		return (thread.message ?? []).some((m) => Array.isArray(m.attachment) && m.attachment.length > 0);
	};

	const newThreads = (threads.thread ?? [])
		.filter((t) => !seenIds.has(t.id))
		.filter((t) => filterRead(t.unread))
		.filter((t) => filterStarred(t as never))
		.filter((t) => filterAttachment(t as never))
		.slice(0, input.maxThreads);

	staticData[seenKey] = [...new Set((threads.thread ?? []).map((t) => t.id))];
	staticData[`mailSeenAt_${mailbox}`] = now;

	if (newThreads.length === 0) return null;

	return newThreads.map((thread) => ({
		json: {
			mailbox,
			mailboxId,
			thread,
			message: thread.message ?? [],
			triggeredAt: now,
		} as unknown as IDataObject,
	}));
}
