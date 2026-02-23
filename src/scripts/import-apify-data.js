/**
 * Import Apify Dataset into MongoDB
 * 
 * Usage: 
 *   node src/scripts/import-apify-data.js
 * 
 * Make sure .env has APIFY_TOKEN and MONGODB_URI set
 */

require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');

// Property Schema (simplified, matches your property.model.js)
const propertySchema = new mongoose.Schema({
  external_id: { type: String, unique: true, required: true },
  source: { type: String, default: 'idealista' },
  title: String,
  description: String,
  type: { type: String, enum: ['apartment', 'house', 'villa', 'penthouse', 'studio', 'duplex', 'loft', 'land', 'commercial', 'office', 'other'] },
  operation: { type: String, enum: ['sale', 'rent'] },
  price: Number,
  price_per_sqm: Number,
  currency: { type: String, default: 'EUR' },
  location: {
    address: String,
    city: String,
    district: String,
    neighborhood: String,
    postal_code: String,
    province: String,
    coordinates: {
      lat: Number,
      lng: Number,
    },
  },
  features: {
    size_sqm: Number,
    bedrooms: Number,
    bathrooms: Number,
    floor: String,
    has_elevator: Boolean,
    has_parking: Boolean,
    has_terrace: Boolean,
    has_pool: Boolean,
    has_garden: Boolean,
    has_storage: Boolean,
    has_ac: Boolean,
    has_heating: Boolean,
    energy_rating: String,
    year_built: Number,
    condition: String,
  },
  images: [String],
  url: String,
  status: { type: String, default: 'active' },
  price_history: [{ price: Number, date: { type: Date, default: Date.now } }],
  last_scraped_at: { type: Date, default: Date.now },
}, { timestamps: true });

const Property = mongoose.model('Property', propertySchema);

// Property type mapping
const TYPE_MAP = {
  'flat': 'apartment',
  'apartment': 'apartment',
  'chalet': 'house',
  'house': 'house',
  'villa': 'villa',
  'penthouse': 'penthouse',
  'studio': 'studio',
  'duplex': 'duplex',
  'loft': 'loft',
  'countryHouse': 'house',
  'land': 'land',
  'office': 'office',
};

function mapProperty(item) {
  const externalId = `idealista_${item.propertyCode}`;
  const type = TYPE_MAP[item.propertyType] || 'apartment';
  
  // Build title
  const typeLabel = type === 'apartment' ? 'Piso' : type === 'house' ? 'Casa' : type === 'villa' ? 'Villa' : type === 'penthouse' ? 'Ático' : 'Propiedad';
  const locationLabel = item.address || item.neighborhood || item.municipality || 'Madrid';
  const title = `${typeLabel} en ${locationLabel}`;

  // Extract images
  const images = [];
  if (item.thumbnail) images.push(item.thumbnail);
  if (item.images) {
    item.images.forEach(img => {
      const url = typeof img === 'string' ? img : img.url;
      if (url && !images.includes(url)) images.push(url);
    });
  }

  return {
    external_id: externalId,
    source: 'idealista',
    title,
    description: item.description || null,
    type,
    operation: item.operation || 'sale',
    price: item.price,
    price_per_sqm: item.priceByArea || (item.price && item.size ? Math.round(item.price / item.size) : null),
    currency: 'EUR',
    location: {
      address: item.address || null,
      city: item.municipality || null,
      district: item.district || null,
      neighborhood: item.neighborhood || null,
      postal_code: null,
      province: item.province || 'Madrid',
      coordinates: {
        lat: item.latitude || null,
        lng: item.longitude || null,
      },
    },
    features: {
      size_sqm: item.size || null,
      bedrooms: item.rooms || null,
      bathrooms: item.bathrooms || null,
      floor: item.floor || null,
      has_elevator: item.hasLift === true,
      has_parking: item.parkingSpace != null,
      has_terrace: item.exterior === true,
      has_pool: item.hasSwimmingPool === true,
      has_garden: item.hasGarden === true,
      has_storage: item.hasStorageRoom === true,
      has_ac: item.hasAirConditioning === true,
      has_heating: false,
      energy_rating: null,
      year_built: null,
      condition: item.newDevelopment ? 'new' : null,
    },
    images,
    url: item.url || null,
    status: 'active',
    price_history: [{ price: item.price, date: new Date() }],
    last_scraped_at: new Date(),
  };
}

async function main() {
  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  const MONGODB_URI = process.env.MONGODB_URI;
  
  if (!APIFY_TOKEN) {
    console.error('❌ APIFY_TOKEN not set in .env');
    process.exit(1);
  }
  if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI not set in .env');
    process.exit(1);
  }

  // Dataset ID from the run we just did
  const DATASET_ID = '5MC9Coz5F2mXeqNK1';
  
  console.log('🔄 Fetching data from Apify dataset...');
  
  try {
    const response = await axios.get(
      `https://api.apify.com/v2/datasets/${DATASET_ID}/items`,
      {
        params: {
          token: APIFY_TOKEN,
          format: 'json',
          clean: true,
        },
        timeout: 30000,
      }
    );

    const items = response.data;
    console.log(`✅ Fetched ${items.length} properties from Apify`);

    // Connect to MongoDB
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Map and save each property
    let saved = 0;
    let updated = 0;
    let errors = 0;

    for (const item of items) {
      try {
        const propertyData = mapProperty(item);
        
        const existing = await Property.findOne({ external_id: propertyData.external_id });
        
        if (existing) {
          // Update existing — track price change
          if (existing.price !== propertyData.price) {
            propertyData.price_history = [
              ...existing.price_history,
              { price: propertyData.price, date: new Date() }
            ];
          } else {
            propertyData.price_history = existing.price_history;
          }
          await Property.updateOne(
            { external_id: propertyData.external_id },
            { $set: { ...propertyData, last_scraped_at: new Date() } }
          );
          updated++;
        } else {
          // Create new
          await Property.create(propertyData);
          saved++;
        }
      } catch (err) {
        if (err.code === 11000) {
          // Duplicate key — skip
          updated++;
        } else {
          console.error(`  ⚠️ Error saving ${item.propertyCode}: ${err.message}`);
          errors++;
        }
      }
    }

    console.log('');
    console.log('📊 Import Results:');
    console.log(`   ✅ New properties saved: ${saved}`);
    console.log(`   🔄 Updated: ${updated}`);
    console.log(`   ❌ Errors: ${errors}`);
    console.log(`   📦 Total processed: ${items.length}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('✅ Done!');
  }
}

main();