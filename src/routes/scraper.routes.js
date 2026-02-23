const express = require('express');
const router = express.Router();
const scraperService = require('../services/idealista.service');
const { SCRAPER_CITIES, COSTA_DEL_SOL_EXTRAS } = require('../config/scraper.config');

/**
 * POST /api/scraper/full
 * Run a full scrape of all cities
 */
router.post('/full', async (req, res, next) => {
  try {
    const { cities, operations, maxItems } = req.body;
    console.log('🚀 Full scrape triggered via API');

    const result = await scraperService.fullScrape({ cities, operations, maxItems });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/scraper/city/:cityKey
 * Scrape a single city
 */
router.post('/city/:cityKey', async (req, res, next) => {
  try {
    const { cityKey } = req.params;
    const { operations, maxItems } = req.body;

    const result = await scraperService.scrapeCity(cityKey, { operations, maxItems });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/scraper/url
 * Scrape a single Idealista search URL
 */
router.post('/url', async (req, res, next) => {
  try {
    const { url, maxItems, city, province, operation } = req.body;
    if (!url) return res.status(400).json({ error: 'url is required' });

    const items = await scraperService.scrapeSearchUrl(url, { maxItems, city, province, operation });
    const saved = await scraperService.saveProperties(items, { city, province, operation });

    res.json({ scraped: items.length, ...saved });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/scraper/deactivate-stale
 * Deactivate properties not seen in recent scrapes
 */
router.post('/deactivate-stale', async (req, res, next) => {
  try {
    const { daysOld = 7 } = req.body;
    const count = await scraperService.deactivateStaleProperties(daysOld);
    res.json({ deactivated: count });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/scraper/stats
 * Get scraper statistics
 */
router.get('/stats', async (req, res, next) => {
  try {
    const stats = await scraperService.getStats();
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/scraper/cities
 * List available cities for scraping
 */
router.get('/cities', (req, res) => {
  const allCities = { ...SCRAPER_CITIES, ...COSTA_DEL_SOL_EXTRAS };
  const cities = Object.entries(allCities).map(([key, city]) => ({
    key,
    name: city.name,
    province: city.province,
    operations: Object.keys(city.searches || {}),
  }));
  res.json({ cities });
});

module.exports = router;