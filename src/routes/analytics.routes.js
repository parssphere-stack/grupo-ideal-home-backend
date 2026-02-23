const express = require('express');
const router = express.Router();
const Conversation = require('../models/conversation.model');
const Property = require('../models/property.model');

/**
 * GET /api/analytics/dashboard
 * Main dashboard stats
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

    // Average lead score
    const avgScore = await Conversation.aggregate([
      { $match: { 'lead_info.score': { $gt: 0 } } },
      { $group: { _id: null, avg: { $avg: '$lead_info.score' } } }
    ]);

    // Language distribution
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
      properties: {
        active: activeProperties
      },
      avg_lead_score: avgScore[0]?.avg || 0,
      channels: channelStats,
      languages: languageStats
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
