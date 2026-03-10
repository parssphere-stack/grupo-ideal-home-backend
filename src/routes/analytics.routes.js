const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const Conversation = require('../models/conversation.model');
const Property = require('../models/property.model');
const Pageview = require('../models/pageview.model');

// ── Helper: parse user-agent ────────────────────────────────
function parseUA(ua = '') {
  const lower = ua.toLowerCase();
  // Device
  let device = 'desktop';
  if (/mobile|android|iphone|ipod/.test(lower)) device = 'mobile';
  else if (/tablet|ipad/.test(lower)) device = 'tablet';
  // Browser
  let browser = 'other';
  if (lower.includes('firefox')) browser = 'Firefox';
  else if (lower.includes('edg')) browser = 'Edge';
  else if (lower.includes('chrome') || lower.includes('crios')) browser = 'Chrome';
  else if (lower.includes('safari')) browser = 'Safari';
  else if (lower.includes('opera') || lower.includes('opr')) browser = 'Opera';
  // OS
  let os = 'other';
  if (lower.includes('windows')) os = 'Windows';
  else if (lower.includes('mac os') || lower.includes('macintosh')) os = 'macOS';
  else if (lower.includes('linux') && !lower.includes('android')) os = 'Linux';
  else if (lower.includes('android')) os = 'Android';
  else if (lower.includes('iphone') || lower.includes('ipad')) os = 'iOS';
  return { device, browser, os };
}

// ── Helper: session ID from IP + UA (hashed, no PII) ───────
function sessionId(ip, ua) {
  const day = new Date().toISOString().slice(0, 10);
  return crypto.createHash('sha256').update(`${ip}|${ua}|${day}`).digest('hex').slice(0, 16);
}

/**
 * POST /api/analytics/track
 * Lightweight pixel — called from frontend on each page view
 */
router.post('/track', async (req, res) => {
  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    const ua = req.headers['user-agent'] || '';
    const { page, referrer, duration, utm_source, utm_medium, utm_campaign } = req.body;
    const { device, browser, os } = parseUA(ua);

    // Country from Netlify/Cloudflare headers
    const country = req.headers['x-country'] || req.headers['cf-ipcountry'] || '';
    const city = req.headers['x-nf-client-connection-city'] || '';

    await Pageview.create({
      sid: sessionId(ip, ua),
      page: page || '/',
      referrer: referrer || req.headers['referer'] || '',
      device, browser, os,
      country, city,
      utm_source, utm_medium, utm_campaign,
      duration: duration || 0,
    });

    res.status(204).end();
  } catch (err) {
    console.error('[Analytics] Track error:', err.message);
    res.status(204).end(); // Never fail the client
  }
});

/**
 * GET /api/analytics/traffic
 * Real-time traffic overview
 */
router.get('/traffic', async (req, res, next) => {
  try {
    const now = new Date();
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    const thisWeek = new Date(today); thisWeek.setDate(thisWeek.getDate() - 7);
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const last30 = new Date(today); last30.setDate(last30.getDate() - 30);

    // Parallel queries
    const [
      todayViews, todayUnique,
      yesterdayViews, yesterdayUnique,
      weekViews, weekUnique,
      monthViews, monthUnique,
      // Live (last 5 min)
      liveViews,
      // Top pages
      topPages,
      // Devices
      devices,
      // Browsers
      browsers,
      // Countries
      countries,
      // Hourly breakdown (today)
      hourly,
      // Daily breakdown (last 30 days)
      daily,
      // Referrers
      referrers,
    ] = await Promise.all([
      Pageview.countDocuments({ createdAt: { $gte: today } }),
      Pageview.distinct('sid', { createdAt: { $gte: today } }).then(r => r.length),
      Pageview.countDocuments({ createdAt: { $gte: yesterday, $lt: today } }),
      Pageview.distinct('sid', { createdAt: { $gte: yesterday, $lt: today } }).then(r => r.length),
      Pageview.countDocuments({ createdAt: { $gte: thisWeek } }),
      Pageview.distinct('sid', { createdAt: { $gte: thisWeek } }).then(r => r.length),
      Pageview.countDocuments({ createdAt: { $gte: thisMonth } }),
      Pageview.distinct('sid', { createdAt: { $gte: thisMonth } }).then(r => r.length),
      // Live visitors (last 5 min)
      Pageview.distinct('sid', { createdAt: { $gte: new Date(now - 5 * 60 * 1000) } }).then(r => r.length),
      // Top pages
      Pageview.aggregate([
        { $match: { createdAt: { $gte: last30 } } },
        { $group: { _id: '$page', views: { $sum: 1 }, unique: { $addToSet: '$sid' } } },
        { $project: { page: '$_id', views: 1, unique: { $size: '$unique' } } },
        { $sort: { views: -1 } }, { $limit: 10 }
      ]),
      // Devices
      Pageview.aggregate([
        { $match: { createdAt: { $gte: last30 } } },
        { $group: { _id: '$device', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      // Browsers
      Pageview.aggregate([
        { $match: { createdAt: { $gte: last30 } } },
        { $group: { _id: '$browser', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      // Countries
      Pageview.aggregate([
        { $match: { createdAt: { $gte: last30 }, country: { $ne: '' } } },
        { $group: { _id: '$country', count: { $sum: 1 } } },
        { $sort: { count: -1 } }, { $limit: 15 }
      ]),
      // Hourly today
      Pageview.aggregate([
        { $match: { createdAt: { $gte: today } } },
        { $group: { _id: { $hour: '$createdAt' }, views: { $sum: 1 }, unique: { $addToSet: '$sid' } } },
        { $project: { hour: '$_id', views: 1, unique: { $size: '$unique' } } },
        { $sort: { hour: 1 } }
      ]),
      // Daily last 30 days
      Pageview.aggregate([
        { $match: { createdAt: { $gte: last30 } } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          views: { $sum: 1 }, unique: { $addToSet: '$sid' }
        }},
        { $project: { date: '$_id', views: 1, unique: { $size: '$unique' } } },
        { $sort: { date: 1 } }
      ]),
      // Referrers
      Pageview.aggregate([
        { $match: { createdAt: { $gte: last30 }, referrer: { $ne: '' } } },
        { $group: { _id: '$referrer', count: { $sum: 1 } } },
        { $sort: { count: -1 } }, { $limit: 10 }
      ]),
    ]);

    res.json({
      live: liveViews,
      today: { views: todayViews, unique: todayUnique },
      yesterday: { views: yesterdayViews, unique: yesterdayUnique },
      week: { views: weekViews, unique: weekUnique },
      month: { views: monthViews, unique: monthUnique },
      topPages, devices, browsers, countries,
      hourly, daily, referrers,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/analytics/dashboard
 * Main dashboard stats (conversations + properties)
 */
router.get('/dashboard', async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const [
      totalConversations,
      todayConversations,
      monthConversations,
      qualifiedLeads,
      activeProperties,
      channelStats
    ] = await Promise.all([
      Conversation.countDocuments(),
      Conversation.countDocuments({ createdAt: { $gte: today } }),
      Conversation.countDocuments({ createdAt: { $gte: thisMonth } }),
      Conversation.countDocuments({ status: 'qualified' }),
      Property.countDocuments({ status: 'active' }),
      Conversation.aggregate([
        { $group: { _id: '$channel', count: { $sum: 1 } } }
      ])
    ]);

    const avgScore = await Conversation.aggregate([
      { $match: { 'lead_info.score': { $gt: 0 } } },
      { $group: { _id: null, avg: { $avg: '$lead_info.score' } } }
    ]);

    const languageStats = await Conversation.aggregate([
      { $group: { _id: '$language', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    res.json({
      conversations: {
        total: totalConversations,
        today: todayConversations,
        this_month: monthConversations,
        qualified: qualifiedLeads
      },
      properties: { active: activeProperties },
      avg_lead_score: avgScore[0]?.avg || 0,
      channels: channelStats,
      languages: languageStats
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
