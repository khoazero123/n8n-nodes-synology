import type { ChatClient } from './ChatClient';
import type { ChatPost } from './types';

export type DeleteScope = 'own' | 'others' | 'all';

export interface DeletePostsInput {
	channelId: number;
	/** Which posts to consider deleting. 'own' = only current user's posts. */
	scope: DeleteScope;
	/**
	 * Only consider posts older than this many milliseconds.
	 * Older-than filter: delete_at condition. Pass 0/null to disable the age filter.
	 */
	olderThanMs: number | null;
	/** Drain at most this many posts from the channel (0 = all available). */
	limit: number;
	/** When true, list + evaluate but do NOT call delete. */
	dryRun: boolean;
	/** Current user id (used to resolve 'own' vs 'others'). */
	currentUserId: number;
}

export interface DeletePostsResult {
	channelId: number;
	scope: DeleteScope;
	dryRun: boolean;
	evaluated: number;
	deleted: number;
	skipped: number;
	errors: number;
	skippedReason: string[];
	postIds: number[];
}

/** True when a post is older than the given age window. */
function isOlderThan(post: ChatPost, now: number, olderThanMs: number | null): boolean {
	if (!olderThanMs || olderThanMs <= 0) return true;
	return now - (post.create_at ?? 0) >= olderThanMs;
}

/**
 * Delete messages in a channel based on scope + old-age filter.
 *
 * Note (verified live 2026-08-11): the Synology Chat API Post.delete (v8) only
 * permits deleting posts created by the logged-in user, and only within a short
 * age window. Other users' posts return error 415. So for 'others'/'all' scopes
 * we can only actually delete the current user's own posts; the rest are skipped
 * and reported (they cannot be deleted through this API with a normal credential).
 */
export async function deletePosts(chat: ChatClient, input: DeletePostsInput): Promise<DeletePostsResult> {
	const now = Date.now();
	const offset = 0;
	const pageSize = Math.max(input.limit > 0 ? Math.min(input.limit, 200) : 200, 1);
	const allPosts: ChatPost[] = [];
	let total = 0;

	// Drain posts (pagination). Stop early once limit reached.
	for (;;) {
		const page = await chat.listPosts({ channelId: input.channelId, offset: offset + allPosts.length, limit: pageSize });
		const posts = page.posts ?? [];
		if (posts.length === 0) break;
		allPosts.push(...posts);
		total = page.total ?? total;
		if (input.limit > 0 && allPosts.length >= input.limit) break;
		if (posts.length < pageSize) break;
	}

	// Evaluate which posts to delete.
	const postIds: number[] = [];
	const skipIds: { id: number; reason: string }[] = [];
	let evaluated = 0;
	for (const post of allPosts.slice(0, input.limit > 0 ? input.limit : undefined)) {
		evaluated++;
		const isOwn = post.creator_id !== undefined && post.creator_id === input.currentUserId;
		if (!isOlderThan(post, now, input.olderThanMs)) {
			skipIds.push({ id: post.post_id, reason: 'newer than age filter' });
			continue;
		}
		// Only own posts are deletable via Post.delete (415 for others).
		// For 'own' scope only own posts pass; for 'others'/'all' we can only
		// actually remove the current user's own posts, others are skipped + reported.
		if (input.scope === 'others' && isOwn) {
			skipIds.push({ id: post.post_id, reason: 'own post (scope=others)' });
			continue;
		}
		if (input.scope === 'own' && !isOwn) {
			skipIds.push({ id: post.post_id, reason: 'other user (not deletable via API)' });
			continue;
		}
		postIds.push(post.post_id);
	}

	let deleted = 0;
	let errors = 0;
	if (!input.dryRun) {
		for (const postId of postIds) {
			try {
				await chat.deletePost(postId);
				deleted++;
			} catch {
				errors++;
				// e.g. 415 if the post exceeded the delete time window.
			}
		}
	}

	const skipped = evaluated - postIds.length;
	const skippedReason: string[] = [
		...skipIds.map((s) => `#${s.id}: ${s.reason}`),
		...(errors > 0 ? [`${errors} delete call(s) failed (likely past the delete time window)`] : []),
	];

	return {
		channelId: input.channelId,
		scope: input.scope,
		dryRun: input.dryRun,
		evaluated,
		deleted: input.dryRun ? postIds.length : deleted,
		skipped,
		errors,
		skippedReason,
		postIds,
	};
}
