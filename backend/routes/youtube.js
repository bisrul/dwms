const express = require('express');
const pool    = require('../models/db');
const authenticateToken = require('../middleware/auth');

const router = express.Router();

const YT_API_BASE = 'https://www.googleapis.com/youtube/v3';
const API_KEY     = process.env.YOUTUBE_API_KEY;

/* ─── Helper: fetch from YouTube ───────────────────────────── */
async function ytFetch(endpoint, params) {
  const url = new URL(`${YT_API_BASE}/${endpoint}`);
  url.searchParams.append('key', API_KEY);
  Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));

  const res  = await fetch(url.toString());
  const data = await res.json();

  if (data.error) {
    throw new Error(data.error.message || 'YouTube API error');
  }
  return data;
}

/* ─── Create tables if not exists ──────────────────────────── */
async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS yt_videos (
      id              SERIAL PRIMARY KEY,
      video_id        VARCHAR(20) UNIQUE,
      title           TEXT,
      channel_id      VARCHAR(30),
      channel_title   VARCHAR(200),
      published_at    TIMESTAMP,
      view_count      BIGINT,
      like_count      BIGINT,
      comment_count   BIGINT,
      duration        VARCHAR(20),
      thumbnail       TEXT,
      description     TEXT,
      tags            TEXT,
      keyword         VARCHAR(200),
      fetched_at      TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS yt_channels (
      id                SERIAL PRIMARY KEY,
      channel_id        VARCHAR(30) UNIQUE,
      title             VARCHAR(200),
      description       TEXT,
      subscriber_count  BIGINT,
      video_count       INT,
      view_count        BIGINT,
      thumbnail         TEXT,
      country           VARCHAR(10),
      fetched_at        TIMESTAMP DEFAULT NOW()
    )
  `);
}

/* ─────────────────────────────────────────────────────────────
   POST /api/youtube/search
   Search videos by keyword and save to DB
───────────────────────────────────────────────────────────── */
router.post('/search', authenticateToken, async (req, res) => {
  const { keyword, maxResults = 10 } = req.body;

  if (!keyword) {
    return res.status(400).json({ error: 'Keyword is required.' });
  }

  if (!API_KEY) {
    return res.status(500).json({ error: 'YouTube API key not configured.' });
  }

  try {
    await ensureTables();

    // Step 1: Search videos
    const searchData = await ytFetch('search', {
      part:       'snippet',
      q:          keyword,
      type:       'video',
      maxResults: Math.min(maxResults, 50),
      order:      'relevance',
    });

    if (!searchData.items?.length) {
      return res.json({ message: 'No videos found.', videos: [], saved: 0 });
    }

    const videoIds = searchData.items.map(i => i.id.videoId).join(',');

    // Step 2: Get video statistics
    const statsData = await ytFetch('videos', {
      part: 'statistics,contentDetails,snippet',
      id:   videoIds,
    });

    // Step 3: Transform & save
    let saved   = 0;
    let skipped = 0;
    const videos = [];

    for (const item of statsData.items) {
      const video = {
        video_id:      item.id,
        title:         item.snippet.title,
        channel_id:    item.snippet.channelId,
        channel_title: item.snippet.channelTitle,
        published_at:  item.snippet.publishedAt,
        view_count:    parseInt(item.statistics?.viewCount    || 0),
        like_count:    parseInt(item.statistics?.likeCount    || 0),
        comment_count: parseInt(item.statistics?.commentCount || 0),
        duration:      item.contentDetails?.duration || '',
        thumbnail:     item.snippet.thumbnails?.medium?.url || '',
        description:   (item.snippet.description || '').slice(0, 500),
        tags:          (item.snippet.tags || []).slice(0, 10).join(', '),
        keyword,
      };

      videos.push(video);

      try {
        await pool.query(`
          INSERT INTO yt_videos
            (video_id, title, channel_id, channel_title, published_at,
             view_count, like_count, comment_count, duration,
             thumbnail, description, tags, keyword)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
          ON CONFLICT (video_id) DO UPDATE SET
            view_count    = EXCLUDED.view_count,
            like_count    = EXCLUDED.like_count,
            comment_count = EXCLUDED.comment_count,
            fetched_at    = NOW()
        `, [
          video.video_id, video.title, video.channel_id,
          video.channel_title, video.published_at,
          video.view_count, video.like_count, video.comment_count,
          video.duration, video.thumbnail, video.description,
          video.tags, video.keyword,
        ]);
        saved++;
      } catch (e) {
        skipped++;
      }
    }

    res.json({
      message:  `Found ${videos.length} videos. Saved ${saved}, skipped ${skipped}.`,
      keyword,
      videos,
      saved,
      skipped,
    });

  } catch (err) {
    console.error('YouTube search error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────
   POST /api/youtube/channel
   Get channel info and save to DB
───────────────────────────────────────────────────────────── */
router.post('/channel', authenticateToken, async (req, res) => {
  const { channelId, username } = req.body;

  if (!channelId && !username) {
    return res.status(400).json({ error: 'channelId or username is required.' });
  }

  try {
    await ensureTables();

    const params = {
      part: 'snippet,statistics',
    };
    if (channelId) params.id       = channelId;
    if (username)  params.forHandle = username;

    const data = await ytFetch('channels', params);

    if (!data.items?.length) {
      return res.status(404).json({ error: 'Channel not found.' });
    }

    const item    = data.items[0];
    const channel = {
      channel_id:       item.id,
      title:            item.snippet.title,
      description:      (item.snippet.description || '').slice(0, 500),
      subscriber_count: parseInt(item.statistics?.subscriberCount || 0),
      video_count:      parseInt(item.statistics?.videoCount      || 0),
      view_count:       parseInt(item.statistics?.viewCount       || 0),
      thumbnail:        item.snippet.thumbnails?.medium?.url || '',
      country:          item.snippet.country || '',
    };

    await pool.query(`
      INSERT INTO yt_channels
        (channel_id, title, description, subscriber_count,
         video_count, view_count, thumbnail, country)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (channel_id) DO UPDATE SET
        subscriber_count = EXCLUDED.subscriber_count,
        video_count      = EXCLUDED.video_count,
        view_count       = EXCLUDED.view_count,
        fetched_at       = NOW()
    `, [
      channel.channel_id, channel.title, channel.description,
      channel.subscriber_count, channel.video_count,
      channel.view_count, channel.thumbnail, channel.country,
    ]);

    res.json({ message: 'Channel saved successfully.', channel });

  } catch (err) {
    console.error('YouTube channel error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────
   GET /api/youtube/videos
   Get saved videos from DB
───────────────────────────────────────────────────────────── */
router.get('/videos', authenticateToken, async (req, res) => {
  const { keyword, limit = 20, offset = 0 } = req.query;
  try {
    let query  = 'SELECT * FROM yt_videos';
    const vals = [];
    if (keyword) {
      query += ' WHERE keyword ILIKE $1';
      vals.push(`%${keyword}%`);
    }
    query += ` ORDER BY view_count DESC LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`;
    vals.push(limit, offset);

    const result = await pool.query(query, vals);
    const count  = await pool.query(
      keyword
        ? 'SELECT COUNT(*) FROM yt_videos WHERE keyword ILIKE $1'
        : 'SELECT COUNT(*) FROM yt_videos',
      keyword ? [`%${keyword}%`] : []
    );

    res.json({
      videos: result.rows,
      total:  parseInt(count.rows[0].count),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch videos.' });
  }
});

/* ─────────────────────────────────────────────────────────────
   GET /api/youtube/stats
   Aggregate stats for dashboard
───────────────────────────────────────────────────────────── */
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    await ensureTables();

    const totals = await pool.query(`
      SELECT
        COUNT(*)                    AS total_videos,
        SUM(view_count)             AS total_views,
        SUM(like_count)             AS total_likes,
        SUM(comment_count)          AS total_comments,
        COUNT(DISTINCT channel_id)  AS total_channels,
        COUNT(DISTINCT keyword)     AS total_keywords
      FROM yt_videos
    `);

    const topVideos = await pool.query(`
      SELECT video_id, title, channel_title, view_count, like_count, thumbnail
      FROM yt_videos
      ORDER BY view_count DESC
      LIMIT 5
    `);

    const byKeyword = await pool.query(`
      SELECT keyword, COUNT(*) AS count, SUM(view_count) AS total_views
      FROM yt_videos
      GROUP BY keyword
      ORDER BY total_views DESC
      LIMIT 10
    `);

    const trend = await pool.query(`
      SELECT
        DATE_TRUNC('day', fetched_at) AS day,
        COUNT(*) AS videos_fetched
      FROM yt_videos
      GROUP BY day
      ORDER BY day DESC
      LIMIT 7
    `);

    res.json({
      totals:     totals.rows[0],
      topVideos:  topVideos.rows,
      byKeyword:  byKeyword.rows,
      trend:      trend.rows,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch YouTube stats.' });
  }
});

/* ─────────────────────────────────────────────────────────────
   DELETE /api/youtube/videos
   Clear all saved videos
───────────────────────────────────────────────────────────── */
router.delete('/videos', authenticateToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM yt_videos');
    res.json({ message: 'All YouTube videos cleared.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear videos.' });
  }
});

module.exports = router;
