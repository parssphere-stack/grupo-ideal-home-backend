const { SCHEDULE } = require('../config/scraper.config');

class ScraperScheduler {
  start() {
    console.log('📅 Scraper scheduler started');
    console.log(`   Full scrape: ${SCHEDULE.fullScrape}`);
    console.log(`   Incremental: ${SCHEDULE.incrementalScrape}`);
    console.log(`   Price check: ${SCHEDULE.priceCheck}`);
  }

  stop() {
    console.log('📅 Scraper scheduler stopped');
  }
}

module.exports = new ScraperScheduler();
