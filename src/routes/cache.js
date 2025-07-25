import { Router } from 'express';
import { cacheManager } from '../middleware/cache.js';

const router = Router();

// Revalidate cache for a specific path
router.post('/revalidate', async (req, res) => {
  try {
    const { path } = req.body;

    if (!path) {
      return res.status(400).json({
        error: 'Path is required'
      });
    }

    const result = await cacheManager.revalidatePath(path);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// Get cache statistics
router.get('/stats', async (req, res) => {
  try {
    const stats = await cacheManager.getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// Clear all cache
router.delete('/', async (req, res) => {
  try {
    const result = await cacheManager.clearAll();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// Get specific cache entry info
router.get('/entry', async (req, res) => {
  try {
    const { url, method = 'GET' } = req.query;

    if (!url) {
      return res.status(400).json({
        error: 'URL parameter is required'
      });
    }

    const exists = await cacheManager.exists(url, method);
    res.json({
      url,
      method,
      exists,
      normalizedUrl: cacheManager.normalizeUrl(url)
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// Cleanup cache based on criteria
router.post('/cleanup', async (req, res) => {
  try {
    const result = await cacheManager.cleanup(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

export default router;