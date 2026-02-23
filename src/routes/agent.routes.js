const express = require('express');
const router = express.Router();
const Agent = require('../models/agent.model');

router.get('/', async (req, res, next) => {
  try {
    const { is_active, area, specialization } = req.query;
    const query = {};
    if (is_active !== undefined) query.is_active = is_active === 'true';
    if (area) query.areas = { $in: [area] };
    if (specialization) query.specialization = { $in: [specialization] };

    const agents = await Agent.find(query)
      .select('-password')
      .sort({ 'stats.rating': -1 });
    res.json(agents);
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const agent = await Agent.findById(req.params.id).select('-password');
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    res.json(agent);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
