const axios = require('axios');
const Property = require('../models/property.model');
const {
  SCRAPER_CITIES,
  COSTA_DEL_SOL_EXTRAS,
  APIFY_CONFIG,
  PROPERTY_TYPE_MAP,
  CONDITION_MAP,
} = require('../config/scraper.config');

class IdealistaScraperService {
  constructor() {
    this.apifyToken = process.env.APIFY_TOKEN;
    this.apifyBaseUrl = 'https://api.apify.com/v2';
    this.stats = {
      total_scraped: 0,
      total_saved: 0,
      total_updated: 0,
      total_errors: 0,
      last_run: null,
    };
  }

  // ═══════════════════════════════════════════════
  // PUBLIC METHODS
  // ═══════════════════════════════════════════════

  /**
   * Full scrape — all cities, all operations (sale + rent)
   * Use this for initial data load or weekly refresh
   */
  async fullScrape(options = {}) {
    console.log('🏠 [Idealista] Starting FULL scrape...');
    this.stats = { total_scraped: 0, total_saved: 0, total_updated: 0, total_errors: 0, last_run: new Date() };

    const allCities = { ...SCRAPER_CITIES, ...COSTA_DEL_SOL_EXTRAS };
    const cityKeys = options.cities || Object.keys(allCities);
    const operations = options.operations || ['sale', 'rent'];

    const results = [];

    for (const cityKey of cityKeys) {
      const city = allCities[cityKey];
      if (!city) {
        console.warn(`⚠️ City "${cityKey}" not found in config, skipping`);
        continue;
      }

      for (const operation of operations) {
        const searches = city.searches?.[operation];
        if (!searches) continue;

        for (const [propertyType, url] of Object.entries(searches)) {
          try {
            console.log(`📍 Scraping ${city.name} — ${operation} — ${propertyType}...`);
            const scraped = await this.scrapeSearchUrl(url, {
              maxItems: options.maxItems || APIFY_CONFIG.defaults.maxItems,
              city: city.name,
              province: city.province,
              operation,
            });

            const saved = await this.saveProperties(scraped, {
              city: city.name,
              province: city.province,
              operation,
            });

            results.push({
              city: city.name,
              operation,
              propertyType,
              scraped: scraped.length,
              saved: saved.saved,
              updated: saved.updated,
              errors: saved.errors,
            });

            console.log(`  ✅ ${city.name}/${operation}: ${scraped.length} scraped, ${saved.saved} new, ${saved.updated} updated`);

            // Rate limit: wait between requests
            await this._sleep(3000);
          } catch (error) {
            console.error(`  ❌ Error scraping ${city.name}/${operation}/${propertyType}:`, error.message);
            this.stats.total_errors++;
            results.push({
              city: city.name,
              operation,
              propertyType,
              error: error.message,
            });
          }
        }
      }
    }

    console.log(`\n🏁 [Idealista] Full scrape complete!`);
    console.log(`   📊 Total: ${this.stats.total_scraped} scraped, ${this.stats.total_saved} new, ${this.stats.total_updated} updated, ${this.stats.total_errors} errors`);

    return {
      stats: { ...this.stats },
      results,
    };
  }

  /**
   * Scrape a single city
   */
  async scrapeCity(cityKey, options = {}) {
    const allCities = { ...SCRAPER_CITIES, ...COSTA_DEL_SOL_EXTRAS };
    const city = allCities[cityKey];
    if (!city) throw new Error(`City "${cityKey}" not found`);

    return this.fullScrape({
      cities: [cityKey],
      operations: options.operations || ['sale', 'rent'],
      maxItems: options.maxItems,
    });
  }

  /**
   * Scrape a single Idealista search URL via Apify
   */
  async scrapeSearchUrl(searchUrl, context = {}) {
    if (!this.apifyToken) {
      throw new Error('APIFY_TOKEN not set. Get one at apify.com');
    }

    const input = {
      searchUrls: [searchUrl],
      maxItems: context.maxItems || APIFY_CONFIG.defaults.maxItems,
      proxyCountry: APIFY_CONFIG.defaults.proxyCountry,
      language: APIFY_CONFIG.defaults.language,
    };

    try {
      // Run the Apify actor and wait for results
      const runUrl = `${this.apifyBaseUrl}/acts/${APIFY_CONFIG.actorId}/run-sync-get-dataset-items`;

      const response = await axios.post(runUrl, input, {
        params: { token: this.apifyToken },
        headers: { 'Content-Type': 'application/json' },
        timeout: 300000, // 5 min timeout (scraping takes time)
      });

      const items = response.data;
      if (!Array.isArray(items)) {
        console.warn('⚠️ Apify returned non-array response');
        return [];
      }

      this.stats.total_scraped += items.length;
      return items;

    } catch (error) {
      // If sync run times out, try async approach
      if (error.code === 'ECONNABORTED' || error.response?.status === 408) {
        console.log('⏳ Sync run timed out, trying async...');
        return this._scrapeAsync(input);
      }
      throw error;
    }
  }

  /**
   * Scrape a single property URL for detailed info
   */
  async scrapePropertyDetail(propertyUrl) {
    if (!this.apifyToken) throw new Error('APIFY_TOKEN not set');

    const input = { url: propertyUrl };

    const runUrl = `${this.apifyBaseUrl}/acts/${APIFY_CONFIG.singleActorId}/run-sync-get-dataset-items`;

    const response = await axios.post(runUrl, input, {
      params: { token: this.apifyToken },
      headers: { 'Content-Type': 'application/json' },
      timeout: 120000,
    });

    const items = response.data;
    return Array.isArray(items) && items.length > 0 ? items[0] : null;
  }

  /**
   * Deactivate properties that are no longer on Idealista
   * (not found in latest scrape)
   */
  async deactivateStaleProperties(daysOld = 7) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);

    const result = await Property.updateMany(
      {
        source: 'idealista',
        status: 'active',
        last_scraped_at: { $lt: cutoff },
      },
      {
        $set: { status: 'inactive' },
      }
    );

    console.log(`🗑️ Deactivated ${result.modifiedCount} stale properties (older than ${daysOld} days)`);
    return result.modifiedCount;
  }

  /**
   * Get scraper stats
   */
  async getStats() {
    const [totalActive, totalInactive, byCityRaw, byOperationRaw, lastScraped] = await Promise.all([
      Property.countDocuments({ source: 'idealista', status: 'active' }),
      Property.countDocuments({ source: 'idealista', status: 'inactive' }),
      Property.aggregate([
        { $match: { source: 'idealista' } },
        { $group: { _id: '$location.city', count: { $sum: 1 }, avgPrice: { $avg: '$price' } } },
        { $sort: { count: -1 } },
      ]),
      Property.aggregate([
        { $match: { source: 'idealista' } },
        { $group: { _id: '$operation', count: { $sum: 1 } } },
      ]),
      Property.findOne({ source: 'idealista' }).sort({ last_scraped_at: -1 }).select('last_scraped_at').lean(),
    ]);

    return {
      active: totalActive,
      inactive: totalInactive,
      by_city: byCityRaw.map(c => ({ city: c._id, count: c.count, avg_price: Math.round(c.avgPrice) })),
      by_operation: byOperationRaw.map(o => ({ operation: o._id, count: o.count })),
      last_scraped_at: lastScraped?.last_scraped_at || null,
      last_run: this.stats.last_run,
    };
  }

  // ═══════════════════════════════════════════════
  // DATA TRANSFORMATION
  // ═══════════════════════════════════════════════

  /**
   * Save array of raw Apify items to MongoDB
   * Uses upsert to avoid duplicates
   */
  async saveProperties(items, context = {}) {
    let saved = 0;
    let updated = 0;
    let errors = 0;

    for (const item of items) {
      try {
        const mapped = this._mapToPropertyModel(item, context);
        if (!mapped) {
          errors++;
          continue;
        }

        // Upsert by external_id
        const existing = await Property.findOne({ external_id: mapped.external_id });

        if (existing) {
          // Update existing — keep views/inquiries, update the rest
          const updateData = { ...mapped };
          delete updateData.views;
          delete updateData.inquiries;
          updateData.last_scraped_at = new Date();

          // Check if price changed
          if (existing.price !== mapped.price) {
            updateData.price_history = [
              ...(existing.price_history || []),
              { price: existing.price, date: existing.updatedAt }
            ];
          }

          await Property.updateOne({ external_id: mapped.external_id }, { $set: updateData });
          updated++;
          this.stats.total_updated++;
        } else {
          // Create new
          mapped.last_scraped_at = new Date();
          await Property.create(mapped);
          saved++;
          this.stats.total_saved++;
        }
      } catch (error) {
        // Duplicate key errors are fine (race condition), skip them
        if (error.code === 11000) {
          updated++;
        } else {
          console.error(`  ⚠️ Error saving property:`, error.message);
          errors++;
          this.stats.total_errors++;
        }
      }
    }

    return { saved, updated, errors };
  }

  /**
   * Map raw Apify/Idealista item to our Property model format
   */
  _mapToPropertyModel(item, context = {}) {
    try {
      // Extract external ID from URL or item
      const externalId = this._extractExternalId(item);
      if (!externalId) return null;

      // Determine property type
      const rawType = (item.propertyType || item.typology || item.type || '').toLowerCase();
      const type = PROPERTY_TYPE_MAP[rawType] || this._guessPropertyType(item);

      // Determine operation
      const operation = context.operation ||
        (item.operation === 'rent' || item.operation === 'alquiler' ? 'rent' : 'sale');

      // Extract price
      const price = this._extractPrice(item);
      if (!price) return null;

      // Build title
      const title = item.title ||
        `${type === 'apartment' ? 'Piso' : 'Propiedad'} en ${item.address || item.neighborhood || context.city || 'España'}`;

      // Extract size
      const sizeSqm = item.size || item.constructedArea || item.propertySpecs?.constructedArea || null;

      // Calculate price per sqm
      const pricePerSqm = (price && sizeSqm) ? Math.round(price / sizeSqm) : null;

      // Extract features
      const features = {
        size_sqm: sizeSqm,
        bedrooms: item.rooms || item.bedrooms || item.propertySpecs?.rooms || null,
        bathrooms: item.bathrooms || item.propertySpecs?.bathrooms || null,
        floor: this._extractFloor(item),
        has_elevator: this._hasFeature(item, ['elevator', 'ascensor', 'lift']),
        has_parking: this._hasFeature(item, ['parking', 'garaje', 'garage']),
        has_terrace: this._hasFeature(item, ['terrace', 'terraza', 'balcony', 'balcón']),
        has_pool: this._hasFeature(item, ['pool', 'piscina', 'swimming']),
        has_garden: this._hasFeature(item, ['garden', 'jardín', 'jardin']),
        has_storage: this._hasFeature(item, ['storage', 'trastero', 'storeroom']),
        has_ac: this._hasFeature(item, ['air conditioning', 'aire acondicionado', 'a/c', 'clima']),
        has_heating: this._hasFeature(item, ['heating', 'calefacción', 'calefaccion']),
        energy_rating: item.energyLabel || item.energyCertification || null,
        year_built: item.yearBuilt || null,
        condition: this._extractCondition(item),
      };

      // Extract images
      const images = this._extractImages(item);

      // Extract location
      const location = {
        address: item.address || item.street || null,
        city: item.municipality || item.city || context.city || null,
        district: item.district || item.neighborhood || null,
        neighborhood: item.neighborhood || item.subNeighborhood || null,
        postal_code: item.postalCode || null,
        province: item.province || context.province || null,
        coordinates: {
          lat: item.latitude || item.coordinates?.lat || null,
          lng: item.longitude || item.coordinates?.lng || null,
        },
      };

      return {
        external_id: `idealista_${externalId}`,
        source: 'idealista',
        title,
        description: item.description || item.comment || null,
        type: type || 'apartment',
        operation,
        price,
        price_per_sqm: pricePerSqm,
        currency: 'EUR',
        location,
        features,
        images,
        url: item.url || item.Url || item.detailUrl || null,
        status: 'active',
      };

    } catch (error) {
      console.error('  ⚠️ Mapping error:', error.message);
      return null;
    }
  }

  // ═══════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════

  /**
   * Async scrape (for when sync times out)
   */
  async _scrapeAsync(input) {
    // Start the run
    const startUrl = `${this.apifyBaseUrl}/acts/${APIFY_CONFIG.actorId}/runs`;
    const startRes = await axios.post(startUrl, input, {
      params: { token: this.apifyToken },
      headers: { 'Content-Type': 'application/json' },
    });

    const runId = startRes.data?.data?.id;
    if (!runId) throw new Error('Failed to start Apify run');

    console.log(`  ⏳ Apify run started: ${runId}, waiting...`);

    // Poll for completion (max 10 minutes)
    const maxWait = 600000;
    const pollInterval = 10000;
    let waited = 0;

    while (waited < maxWait) {
      await this._sleep(pollInterval);
      waited += pollInterval;

      const statusRes = await axios.get(`${this.apifyBaseUrl}/actor-runs/${runId}`, {
        params: { token: this.apifyToken },
      });

      const status = statusRes.data?.data?.status;
      if (status === 'SUCCEEDED') {
        // Get dataset items
        const datasetId = statusRes.data?.data?.defaultDatasetId;
        const itemsRes = await axios.get(`${this.apifyBaseUrl}/datasets/${datasetId}/items`, {
          params: { token: this.apifyToken },
        });
        return itemsRes.data || [];
      }

      if (status === 'FAILED' || status === 'ABORTED') {
        throw new Error(`Apify run ${status}`);
      }

      console.log(`  ⏳ Still running... (${Math.round(waited / 1000)}s)`);
    }

    throw new Error('Apify run timed out (10 min)');
  }

  _extractExternalId(item) {
    // Try direct ID
    if (item.id || item.propertyCode) return item.id || item.propertyCode;

    // Try extracting from URL
    const url = item.url || item.Url || item.detailUrl || '';
    const match = url.match(/\/inmueble\/(\d+)|\/immobile\/(\d+)|\/(\d+)\/?$/);
    if (match) return match[1] || match[2] || match[3];

    // Try from thumbnail URL
    const thumbnail = item.thumbnail || item.MainImage || '';
    const thumbMatch = thumbnail.match(/\/(\d{6,})\./);
    if (thumbMatch) return thumbMatch[1];

    return null;
  }

  _extractPrice(item) {
    if (typeof item.price === 'number') return item.price;
    if (typeof item.price === 'string') {
      const cleaned = item.price.replace(/[^0-9.,]/g, '').replace(/\./g, '').replace(',', '.');
      const num = parseFloat(cleaned);
      return isNaN(num) ? null : num;
    }
    if (item.priceInfo?.price?.amount) return item.priceInfo.price.amount;
    return null;
  }

  _extractFloor(item) {
    if (item.floor != null) {
      const f = String(item.floor).toLowerCase();
      if (f === 'bj' || f === 'bajo' || f === 'ground') return 0;
      const num = parseInt(f);
      return isNaN(num) ? null : num;
    }
    return null;
  }

  _hasFeature(item, keywords) {
    const searchIn = [
      item.description || '',
      item.comment || '',
      ...(item.characteristics || []),
      ...(item.features || []),
      ...(item.amenities || []),
    ].join(' ').toLowerCase();

    return keywords.some(kw => searchIn.includes(kw.toLowerCase())) || false;
  }

  _guessPropertyType(item) {
    const text = [
      item.title || '',
      item.description || '',
      ...(item.characteristics || []),
    ].join(' ').toLowerCase();

    if (text.includes('ático') || text.includes('penthouse') || text.includes('atico')) return 'penthouse';
    if (text.includes('villa')) return 'villa';
    if (text.includes('chalet') || text.includes('casa')) return 'house';
    if (text.includes('estudio') || text.includes('studio') || text.includes('loft')) return 'studio';
    if (text.includes('local') || text.includes('oficina') || text.includes('office')) return 'commercial';
    if (text.includes('terreno') || text.includes('land') || text.includes('parcela')) return 'land';
    return 'apartment'; // default
  }

  _extractCondition(item) {
    const raw = (item.status || item.condition || '').toLowerCase();
    if (CONDITION_MAP[raw]) return CONDITION_MAP[raw];

    const text = [
      item.description || '',
      ...(item.characteristics || []),
    ].join(' ').toLowerCase();

    if (text.includes('obra nueva') || text.includes('a estrenar') || text.includes('new build')) return 'new';
    if (text.includes('reformado') || text.includes('refurbished') || text.includes('renovated')) return 'renovated';
    if (text.includes('a reformar') || text.includes('to refurbish') || text.includes('to renovate')) return 'needs_renovation';
    if (text.includes('buen estado') || text.includes('good condition')) return 'good';

    return null;
  }

  _extractImages(item) {
    // Try different image formats
    if (item.images && Array.isArray(item.images)) {
      return item.images.map(img => {
        if (typeof img === 'string') return img;
        return img.url || img.src || img.originalUrl || null;
      }).filter(Boolean).slice(0, 20); // max 20 images
    }

    if (item.multimedia?.images) {
      return item.multimedia.images.map(img => img.url || img.src).filter(Boolean).slice(0, 20);
    }

    // Single main image
    if (item.MainImage || item.thumbnail) {
      return [item.MainImage || item.thumbnail];
    }

    return [];
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new IdealistaScraperService();
