const express = require('express');
const router = express.Router();
const chatService = require('../services/chat.service');
const rateLimit = require('express-rate-limit');

// Rate limiting for chat
const chatLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 messages per minute
  message: { error: 'Too many messages, please slow down' }
});

/**
 * POST /api/chat/start
 * Start a new conversation
 */
router.post('/start', async (req, res, next) => {
  try {
    const { channel, language, source_url } = req.body;
    const result = await chatService.startConversation({
      channel,
      language,
      source_url,
      ip_address: req.ip,
      user_agent: req.headers['user-agent']
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/chat/message
 * Send a message and get AI response
 */
router.post('/message', chatLimiter, async (req, res, next) => {
  try {
    const { session_id, message } = req.body;

    if (!session_id || !message) {
      return res.status(400).json({ error: 'session_id and message are required' });
    }

    if (message.length > 2000) {
      return res.status(400).json({ error: 'Message too long (max 2000 chars)' });
    }

    const result = await chatService.processMessage(session_id, message);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/chat/:session_id
 * Get conversation history
 */
router.get('/:session_id', async (req, res, next) => {
  try {
    const conversation = await chatService.getConversation(req.params.session_id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    res.json(conversation);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/chat
 * List conversations (for dashboard)
 */
router.get('/', async (req, res, next) => {
  try {
    const { status, channel, page, limit } = req.query;
    const result = await chatService.getConversations({
      status,
      channel,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/chat/:session_id/handoff
 * Hand off to human agent
 */
router.post('/:session_id/handoff', async (req, res, next) => {
  try {
    const { agent_id, reason } = req.body;
    const result = await chatService.handoffToAgent(
      req.params.session_id,
      agent_id,
      reason
    );
    res.json({ success: true, conversation: result });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
