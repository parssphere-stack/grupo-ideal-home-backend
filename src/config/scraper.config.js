// Idealista Scraper Configuration
// Defines target cities, search URLs, and mapping rules for Apify scraper

const SCRAPER_CITIES = {
  madrid: {
    name: 'Madrid',
    province: 'Madrid',
    searches: {
      sale: {
        homes: 'https://www.idealista.com/venta-viviendas/madrid-madrid/',
        newDevelopments: 'https://www.idealista.com/obra-nueva/madrid-madrid/',
      },
      rent: {
        homes: 'https://www.idealista.com/alquiler-viviendas/madrid-madrid/',
      }
    },
    // Districts to scrape individually for better coverage
    districts: [
      'centro', 'arganzuela', 'retiro', 'salamanca', 'chamartin',
      'tetuan', 'chamberi', 'fuencarral-el-pardo', 'moncloa-aravaca',
      'latina', 'carabanchel', 'usera', 'puente-de-vallecas',
      'moratalaz', 'ciudad-lineal', 'hortaleza', 'villaverde',
      'villa-de-vallecas', 'vicalvaro', 'san-blas-canillejas', 'barajas'
    ]
  },
  barcelona: {
    name: 'Barcelona',
    province: 'Barcelona',
    searches: {
      sale: {
        homes: 'https://www.idealista.com/venta-viviendas/barcelona-barcelona/',
        newDevelopments: 'https://www.idealista.com/obra-nueva/barcelona-barcelona/',
      },
      rent: {
        homes: 'https://www.idealista.com/alquiler-viviendas/barcelona-barcelona/',
      }
    },
    districts: [
      'ciutat-vella', 'eixample', 'sants-montjuic', 'les-corts',
      'sarria-sant-gervasi', 'gracia', 'horta-guinardo',
      'nou-barris', 'sant-andreu', 'sant-marti'
    ]
  },
  malaga: {
    name: 'Málaga',
    province: 'Málaga',
    searches: {
      sale: {
        homes: 'https://www.idealista.com/venta-viviendas/malaga-malaga/',
        newDevelopments: 'https://www.idealista.com/obra-nueva/malaga-malaga/',
      },
      rent: {
        homes: 'https://www.idealista.com/alquiler-viviendas/malaga-malaga/',
      }
    },
    // Costa del Sol areas
    districts: [
      'centro', 'este', 'ciudad-jardin', 'bailen-miraflores',
      'palma-palmilla', 'cruz-de-humilladero', 'carretera-de-cadiz',
      'churriana', 'campanillas', 'puerto-de-la-torre', 'teatinos'
    ]
  }
};

// Costa del Sol extra cities (will be added as separate searches)
const COSTA_DEL_SOL_EXTRAS = {
  marbella: {
    name: 'Marbella',
    province: 'Málaga',
    searches: {
      sale: { homes: 'https://www.idealista.com/venta-viviendas/marbella-malaga/' },
      rent: { homes: 'https://www.idealista.com/alquiler-viviendas/marbella-malaga/' }
    }
  },
  estepona: {
    name: 'Estepona',
    province: 'Málaga',
    searches: {
      sale: { homes: 'https://www.idealista.com/venta-viviendas/estepona-malaga/' },
      rent: { homes: 'https://www.idealista.com/alquiler-viviendas/estepona-malaga/' }
    }
  },
  fuengirola: {
    name: 'Fuengirola',
    province: 'Málaga',
    searches: {
      sale: { homes: 'https://www.idealista.com/venta-viviendas/fuengirola-malaga/' },
      rent: { homes: 'https://www.idealista.com/alquiler-viviendas/fuengirola-malaga/' }
    }
  },
  torremolinos: {
    name: 'Torremolinos',
    province: 'Málaga',
    searches: {
      sale: { homes: 'https://www.idealista.com/venta-viviendas/torremolinos-malaga/' },
      rent: { homes: 'https://www.idealista.com/alquiler-viviendas/torremolinos-malaga/' }
    }
  },
  benalmadena: {
    name: 'Benalmádena',
    province: 'Málaga',
    searches: {
      sale: { homes: 'https://www.idealista.com/venta-viviendas/benalmadena-malaga/' },
      rent: { homes: 'https://www.idealista.com/alquiler-viviendas/benalmadena-malaga/' }
    }
  }
};

// Apify actor configuration
const APIFY_CONFIG = {
  // Main bulk scraper actor
  actorId: 'axlymxp~idealista-scraper',
  // Single property scraper
  singleActorId: 'dz_omar~idealista-scraper-api',
  // Default scraper settings
  defaults: {
    maxItems: 500,        // per search URL
    proxyCountry: 'ES',   // Spanish proxies for best results
    language: 'es',
  }
};

// Map Idealista property types to our model types
const PROPERTY_TYPE_MAP = {
  'flat': 'apartment',
  'apartment': 'apartment',
  'piso': 'apartment',
  'house': 'house',
  'chalet': 'house',
  'casa': 'house',
  'villa': 'villa',
  'studio': 'studio',
  'estudio': 'studio',
  'penthouse': 'penthouse',
  'atico': 'penthouse',
  'ático': 'penthouse',
  'duplex': 'apartment',
  'dúplex': 'apartment',
  'loft': 'studio',
  'land': 'land',
  'terreno': 'land',
  'premises': 'commercial',
  'local': 'commercial',
  'office': 'commercial',
  'oficina': 'commercial',
  'garage': 'commercial',
  'garaje': 'commercial',
};

// Map Idealista condition to our model condition
const CONDITION_MAP = {
  'newdevelopment': 'new',
  'good': 'good',
  'renew': 'needs_renovation',
  'refurbished': 'renovated',
  'new': 'new',
  'a reformar': 'needs_renovation',
  'buen estado': 'good',
  'a estrenar': 'new',
  'reformado': 'renovated',
};

// Scrape schedule configuration
const SCHEDULE = {
  // Full scrape: once a week (Sunday at 3am)
  fullScrape: '0 3 * * 0',
  // Incremental scrape: daily at 6am (new listings only)
  incrementalScrape: '0 6 * * *',
  // Price update check: every 12 hours
  priceCheck: '0 */12 * * *',
};

module.exports = {
  SCRAPER_CITIES,
  COSTA_DEL_SOL_EXTRAS,
  APIFY_CONFIG,
  PROPERTY_TYPE_MAP,
  CONDITION_MAP,
  SCHEDULE,
};
