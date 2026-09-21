import { Router } from 'express';
import { queryMany, queryOne } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/http.js';

export const analyticsRouter: Router = Router();

analyticsRouter.use(requireAuth);

analyticsRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const days = Math.min(365, Math.max(1, Number.parseInt(String(req.query.days ?? '30'), 10) || 30));

    const byPlatform = await queryMany<{
      platform: string;
      views: number;
      likes: number;
      comments: number;
      shares: number;
      followers_gained: number;
      watch_time_sec: number;
      posts: number;
    }>(
      `WITH latest AS (
         SELECT DISTINCT ON (a.social_post_id) a.*
         FROM analytics a
         JOIN social_posts sp ON sp.id = a.social_post_id
         JOIN videos v ON v.id = sp.video_id
         JOIN projects p ON p.id = v.project_id
         WHERE p.user_id = $1
         ORDER BY a.social_post_id, a.collected_at DESC
       )
       SELECT platform,
              COALESCE(SUM(views), 0)::bigint            AS views,
              COALESCE(SUM(likes), 0)::bigint            AS likes,
              COALESCE(SUM(comments), 0)::bigint         AS comments,
              COALESCE(SUM(shares), 0)::bigint           AS shares,
              COALESCE(SUM(followers_gained), 0)::bigint AS followers_gained,
              COALESCE(SUM(watch_time_sec), 0)::bigint   AS watch_time_sec,
              COUNT(*)::int                              AS posts
       FROM latest
       GROUP BY platform
       ORDER BY views DESC`,
      [req.user!.id],
    );

    const timeline = await queryMany<{
      day: string;
      views: number;
      likes: number;
      comments: number;
      published: number;
    }>(
      `SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
              COALESCE(SUM(a.views), 0)::bigint    AS views,
              COALESCE(SUM(a.likes), 0)::bigint    AS likes,
              COALESCE(SUM(a.comments), 0)::bigint AS comments,
              COUNT(DISTINCT sp.id) FILTER (WHERE date_trunc('day', sp.published_at) = d.day)::int AS published
       FROM generate_series(date_trunc('day', now()) - ($2 || ' days')::interval, date_trunc('day', now()), '1 day') AS d(day)
       LEFT JOIN analytics a ON date_trunc('day', a.collected_at) = d.day
       LEFT JOIN social_posts sp ON sp.id = a.social_post_id
       LEFT JOIN videos v ON v.id = sp.video_id
       LEFT JOIN projects p ON p.id = v.project_id AND p.user_id = $1
       GROUP BY d.day
       ORDER BY d.day`,
      [req.user!.id, String(days)],
    );

    const totals = byPlatform.reduce(
      (acc, row) => ({
        views: acc.views + Number(row.views),
        likes: acc.likes + Number(row.likes),
        comments: acc.comments + Number(row.comments),
        shares: acc.shares + Number(row.shares),
        followersGained: acc.followersGained + Number(row.followers_gained),
        watchTimeSec: acc.watchTimeSec + Number(row.watch_time_sec),
      }),
      { views: 0, likes: 0, comments: 0, shares: 0, followersGained: 0, watchTimeSec: 0 },
    );

    const engagement = totals.views > 0 ? ((totals.likes + totals.comments + totals.shares) / totals.views) * 100 : 0;

    res.json({
      totals: { ...totals, engagementRate: Number(engagement.toFixed(2)) },
      byPlatform: byPlatform.map((row) => ({
        platform: row.platform,
        views: Number(row.views),
        likes: Number(row.likes),
        comments: Number(row.comments),
        shares: Number(row.shares),
        followersGained: Number(row.followers_gained),
        watchTimeSec: Number(row.watch_time_sec),
        posts: row.posts,
      })),
      timeline: timeline.map((row) => ({
        day: row.day,
        views: Number(row.views),
        likes: Number(row.likes),
        comments: Number(row.comments),
        published: row.published,
      })),
    });
  }),
);

analyticsRouter.get(
  '/top',
  asyncHandler(async (req, res) => {
    const limit = Math.min(50, Math.max(1, Number.parseInt(String(req.query.limit ?? '10'), 10) || 10));
    const rows = await queryMany<{
      post_id: string;
      video_id: string;
      title: string;
      platform: string;
      views: number;
      likes: number;
      comments: number;
      engagement_rate: number;
      published_at: Date | null;
      external_url: string | null;
    }>(
      `WITH latest AS (
         SELECT DISTINCT ON (a.social_post_id) a.*
         FROM analytics a
         ORDER BY a.social_post_id, a.collected_at DESC
       )
       SELECT sp.id AS post_id, v.id AS video_id, v.title, sp.platform,
              COALESCE(latest.views, 0)::bigint AS views,
              COALESCE(latest.likes, 0)::bigint AS likes,
              COALESCE(latest.comments, 0)::bigint AS comments,
              COALESCE(latest.engagement_rate, 0) AS engagement_rate,
              sp.published_at, sp.external_url
       FROM social_posts sp
       JOIN videos v ON v.id = sp.video_id
       JOIN projects p ON p.id = v.project_id
       LEFT JOIN latest ON latest.social_post_id = sp.id
       WHERE p.user_id = $1 AND sp.status = 'published'
       ORDER BY views DESC NULLS LAST
       LIMIT $2`,
      [req.user!.id, limit],
    );

    res.json({
      items: rows.map((row) => ({
        postId: row.post_id,
        videoId: row.video_id,
        title: row.title,
        platform: row.platform,
        views: Number(row.views),
        likes: Number(row.likes),
        comments: Number(row.comments),
        engagementRate: Number(row.engagement_rate),
        publishedAt: row.published_at,
        externalUrl: row.external_url,
      })),
    });
  }),
);

analyticsRouter.get(
  '/posts/:postId',
  asyncHandler(async (req, res) => {
    const owned = await queryOne<{ id: string }>(
      `SELECT sp.id FROM social_posts sp
       JOIN videos v ON v.id = sp.video_id
       JOIN projects p ON p.id = v.project_id
       WHERE sp.id = $1 AND p.user_id = $2`,
      [req.params.postId!, req.user!.id],
    );
    if (!owned) {
      res.status(404).json({ error: { code: 'not_found', message: 'Veroeffentlichung nicht gefunden' } });
      return;
    }

    const history = await queryMany<{
      collected_at: Date;
      views: number;
      likes: number;
      comments: number;
      shares: number;
      watch_time_sec: number;
      engagement_rate: number;
    }>(
      `SELECT collected_at, views, likes, comments, shares, watch_time_sec, engagement_rate
       FROM analytics WHERE social_post_id = $1 ORDER BY collected_at`,
      [req.params.postId!],
    );

    res.json({ items: history });
  }),
);
