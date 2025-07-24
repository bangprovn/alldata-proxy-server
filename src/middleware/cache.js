import CacheManager from '../cacheManager.js';
import { config } from '../config/index.js';

const cacheManager = new CacheManager(config.paths.cache);

export async function cacheMiddleware(req, res, next) {
  // Skip caching for non-GET/POST or non-API requests
  if (!['GET', 'POST'].includes(req.method) || !isApiRequest(req)) {
    return next();
  }

  try {
    const cachedData = await cacheManager.load(req.originalUrl, req.method, req.body);
    if (cachedData) {
      console.log(`Cache hit for ${req.method}: ${req.originalUrl}`);
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('X-Cache-From', 'SQLite-Index');
      res.setHeader('Content-Type', 'application/json');
      return res.json(cachedData);
    }
  } catch (error) {
    console.error('Cache middleware error:', error);
  }

  // Add cache save function to response
  res.saveToCache = async (data) => {
    try {
      await cacheManager.save(req.originalUrl, data, req.method, req.body);
      res.setHeader('X-Cache', 'MISS');
    } catch (error) {
      console.error('Failed to save to cache:', error);
    }
  };

  next();
}

// Initialize cache database on startup
(async () => {
  try {
    await cacheManager.initializeDatabase();
    console.log('Cache database initialized successfully');
  } catch (error) {
    console.error('Failed to initialize cache database:', error);
  }
})();

function isApiRequest(req) {
  return req.headers['content-type']?.includes('application/json') || 
         req.headers['accept']?.includes('application/json') ||
         req.originalUrl.includes('/api/') ||
         req.originalUrl.includes('/alldata/');
}

export { cacheManager };