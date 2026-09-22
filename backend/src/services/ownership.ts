import { queryOne } from '../db/pool.js';

const CACHE_LIMIT = 2000;
const videoOwners = new Map<string, string>();

function remember(videoId: string, userId: string): string {
  if (videoOwners.size >= CACHE_LIMIT) {
    const oldest = videoOwners.keys().next().value;
    if (oldest) videoOwners.delete(oldest);
  }
  videoOwners.set(videoId, userId);
  return userId;
}

export async function ownerOfVideo(videoId: string | null | undefined): Promise<string | null> {
  if (!videoId) return null;

  const cached = videoOwners.get(videoId);
  if (cached) return cached;

  const row = await queryOne<{ user_id: string }>(
    `SELECT p.user_id FROM videos v JOIN projects p ON p.id = v.project_id WHERE v.id = $1`,
    [videoId],
  );
  if (!row) return null;
  return remember(videoId, row.user_id);
}

export async function ownerOfPost(postId: string | null | undefined): Promise<string | null> {
  if (!postId) return null;

  const row = await queryOne<{ user_id: string; video_id: string }>(
    `SELECT p.user_id, sp.video_id FROM social_posts sp
     JOIN videos v ON v.id = sp.video_id
     JOIN projects p ON p.id = v.project_id
     WHERE sp.id = $1`,
    [postId],
  );
  if (!row) return null;
  return remember(row.video_id, row.user_id);
}

export function forgetVideoOwner(videoId: string): void {
  videoOwners.delete(videoId);
}
