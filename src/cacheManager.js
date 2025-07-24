import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import sqlite3 from 'sqlite3';
import { promisify } from 'util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class CacheManager {
  constructor(cacheDir = path.join(__dirname, '..', 'cache')) {
    this.cacheDir = cacheDir;
    this.dbPath = path.join(cacheDir, 'cache-index.db');
    this.db = null;
    this.dbRun = null;
    this.dbGet = null;
    this.dbAll = null;
    this.ensureCacheDirectory();
    this.initializeDatabase();
  }

  ensureCacheDirectory() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  async initializeDatabase() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          console.error('Error opening database:', err);
          reject(err);
          return;
        }

        // Promisify database methods
        this.dbRun = promisify(this.db.run.bind(this.db));
        this.dbGet = promisify(this.db.get.bind(this.db));
        this.dbAll = promisify(this.db.all.bind(this.db));

        // Create cache index table with proper indexes
        const createTableSQL = `
          CREATE TABLE IF NOT EXISTS cache_index (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL,
            normalized_url TEXT NOT NULL,
            method TEXT NOT NULL,
            body TEXT,
            file_path TEXT NOT NULL,
            size INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            access_count INTEGER DEFAULT 1,
            UNIQUE(normalized_url, method, body)
          );
          
          CREATE INDEX IF NOT EXISTS idx_normalized_url ON cache_index(normalized_url);
          CREATE INDEX IF NOT EXISTS idx_method ON cache_index(method);
          CREATE INDEX IF NOT EXISTS idx_created_at ON cache_index(created_at);
          CREATE INDEX IF NOT EXISTS idx_accessed_at ON cache_index(accessed_at);
          CREATE INDEX IF NOT EXISTS idx_size ON cache_index(size);
        `;

        this.db.exec(createTableSQL, (err) => {
          if (err) {
            console.error('Error creating table:', err);
            reject(err);
          } else {
            console.log('Cache database initialized');
            resolve();
          }
        });
      });
    });
  }

  // Normalize URL by removing timestamp parameters and query params
  normalizeUrl(url) {
    try {
      const urlObj = new URL(url, 'http://localhost');
      const pathname = urlObj.pathname;
      const searchParams = new URLSearchParams(urlObj.search);
      
      // Remove common timestamp parameters
      const timestampParams = ['_', 'timestamp', 't', 'ts', 'cache', 'cachebuster'];
      timestampParams.forEach(param => searchParams.delete(param));
      
      // Sort remaining params for consistent cache keys
      const sortedParams = Array.from(searchParams.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join('&');
      
      const normalizedUrl = pathname + (sortedParams ? '?' + sortedParams : '');
      return normalizedUrl;
    } catch (error) {
      return url;
    }
  }

  // Generate hierarchical path from URL
  getHierarchicalPath(url) {
    const normalizedUrl = this.normalizeUrl(url);
    const urlParts = normalizedUrl.split('/').filter(part => part);
    
    // Create a directory structure based on URL path
    const dirParts = urlParts.slice(0, -1);
    const fileName = urlParts.slice(-1)[0] || 'index';
    
    // Clean filename for filesystem
    const cleanFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    
    return {
      dirPath: dirParts.join(path.sep),
      fileName: cleanFileName
    };
  }

  // Generate cache key from normalized URL and optional body
  getCacheKey(url, method = 'GET', body = null) {
    const normalizedUrl = this.normalizeUrl(url);
    let cacheString = `${method}:${normalizedUrl}`;
    
    // Include body in cache key for POST requests
    if (method === 'POST' && body) {
      const bodyString = typeof body === 'string' ? body : JSON.stringify(body);
      cacheString += `:${bodyString}`;
    }
    
    const hash = crypto.createHash('md5').update(cacheString).digest('hex');
    return hash;
  }

  // Get cache file path with hierarchical structure
  getCachePath(url, method = 'GET', body = null) {
    const { dirPath, fileName } = this.getHierarchicalPath(url);
    const cacheKey = this.getCacheKey(url, method, body);
    
    // Create hierarchical directory structure
    const fullDirPath = path.join(this.cacheDir, 'data', dirPath);
    
    // Use first 2 chars of hash for additional sharding
    const shardDir = cacheKey.substring(0, 2);
    const finalDirPath = path.join(fullDirPath, shardDir);
    
    // Filename includes part of original filename for readability
    const finalFileName = `${fileName}_${cacheKey}.json`;
    
    return {
      dirPath: finalDirPath,
      filePath: path.join(finalDirPath, finalFileName)
    };
  }

  // Save data to cache with index update
  async save(url, data, method = 'GET', body = null) {
    try {
      const { dirPath, filePath } = this.getCachePath(url, method, body);
      
      // Ensure directory exists
      await fs.promises.mkdir(dirPath, { recursive: true });
      
      const cacheData = {
        url: url,
        normalizedUrl: this.normalizeUrl(url),
        method: method,
        body: body,
        timestamp: new Date().toISOString(),
        data: data
      };
      
      await fs.promises.writeFile(filePath, JSON.stringify(cacheData, null, 2));
      
      // Get file size
      const stats = await fs.promises.stat(filePath);
      
      // Update database index
      const bodyString = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
      
      await this.dbRun(`
        INSERT OR REPLACE INTO cache_index 
        (url, normalized_url, method, body, file_path, size, created_at, accessed_at, access_count)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 
          COALESCE((SELECT access_count FROM cache_index WHERE normalized_url = ? AND method = ? AND COALESCE(body, '') = COALESCE(?, '')), 0) + 1)
      `, [url, this.normalizeUrl(url), method, bodyString, filePath, stats.size, 
          this.normalizeUrl(url), method, bodyString]);
      
      console.log(`Cached ${method} response for: ${this.normalizeUrl(url)}`);
      return true;
    } catch (error) {
      console.error('Error saving to cache:', error);
      return false;
    }
  }

  // Load data from cache using index
  async load(url, method = 'GET', body = null) {
    try {
      const normalizedUrl = this.normalizeUrl(url);
      const bodyString = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
      
      // Query database for cache entry
      const row = await this.dbGet(`
        SELECT file_path FROM cache_index 
        WHERE normalized_url = ? AND method = ? AND COALESCE(body, '') = COALESCE(?, '')
      `, [normalizedUrl, method, bodyString || '']);
      
      if (!row || !fs.existsSync(row.file_path)) {
        return null;
      }
      
      // Update access time and count
      await this.dbRun(`
        UPDATE cache_index 
        SET accessed_at = CURRENT_TIMESTAMP, access_count = access_count + 1
        WHERE normalized_url = ? AND method = ? AND COALESCE(body, '') = COALESCE(?, '')
      `, [normalizedUrl, method, bodyString || '']);
      
      const cacheContent = await fs.promises.readFile(row.file_path, 'utf-8');
      const cacheData = JSON.parse(cacheContent);
      
      console.log(`Cache hit for ${method}: ${normalizedUrl}`);
      return cacheData.data;
    } catch (error) {
      console.error('Error loading from cache:', error);
      return null;
    }
  }

  // Check if cache exists for URL using index
  async exists(url, method = 'GET', body = null) {
    const normalizedUrl = this.normalizeUrl(url);
    const bodyString = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    
    const row = await this.dbGet(`
      SELECT 1 FROM cache_index 
      WHERE normalized_url = ? AND method = ? AND COALESCE(body, '') = COALESCE(?, '')
    `, [normalizedUrl, method, bodyString || '']);
    
    return !!row;
  }

  // Revalidate cache for a path using index
  async revalidatePath(pathPrefix) {
    try {
      // Find all entries matching the path prefix
      const rows = await this.dbAll(`
        SELECT id, file_path, normalized_url FROM cache_index 
        WHERE normalized_url LIKE ?
      `, [pathPrefix + '%']);
      
      let deletedCount = 0;
      
      for (const row of rows) {
        try {
          if (fs.existsSync(row.file_path)) {
            await fs.promises.unlink(row.file_path);
          }
          
          await this.dbRun('DELETE FROM cache_index WHERE id = ?', [row.id]);
          deletedCount++;
          console.log(`Revalidated cache for: ${row.normalized_url}`);
        } catch (error) {
          console.error(`Error deleting cache entry ${row.id}:`, error);
        }
      }
      
      // Clean up empty directories
      await this.cleanEmptyDirectories();
      
      return {
        success: true,
        message: `Revalidated ${deletedCount} cache entries for path: ${pathPrefix}`,
        deletedCount
      };
    } catch (error) {
      console.error('Error revalidating cache:', error);
      return {
        success: false,
        message: error.message,
        deletedCount: 0
      };
    }
  }

  // Clean up empty directories
  async cleanEmptyDirectories(dir = path.join(this.cacheDir, 'data')) {
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const fullPath = path.join(dir, entry.name);
          await this.cleanEmptyDirectories(fullPath);
          
          // Check if directory is empty after recursive cleaning
          const remainingEntries = await fs.promises.readdir(fullPath);
          if (remainingEntries.length === 0) {
            await fs.promises.rmdir(fullPath);
          }
        }
      }
    } catch (error) {
      console.error('Error cleaning directories:', error);
    }
  }

  // Clear entire cache
  async clearAll() {
    try {
      // Delete all files referenced in the database
      const rows = await this.dbAll('SELECT file_path FROM cache_index');
      
      for (const row of rows) {
        try {
          if (fs.existsSync(row.file_path)) {
            await fs.promises.unlink(row.file_path);
          }
        } catch (error) {
          console.error(`Error deleting file ${row.file_path}:`, error);
        }
      }
      
      // Clear database
      await this.dbRun('DELETE FROM cache_index');
      
      // Clean up empty directories
      await this.cleanEmptyDirectories();
      
      return { success: true, message: 'Cache cleared successfully' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  // Get cache statistics with advanced metrics
  async getStats() {
    try {
      const stats = await this.dbGet(`
        SELECT 
          COUNT(*) as totalEntries,
          SUM(size) as totalSize,
          AVG(size) as avgSize,
          MAX(size) as maxSize,
          MIN(size) as minSize,
          AVG(access_count) as avgAccessCount,
          MAX(access_count) as maxAccessCount
        FROM cache_index
      `);
      
      const topAccessed = await this.dbAll(`
        SELECT normalized_url, method, access_count, size, accessed_at
        FROM cache_index
        ORDER BY access_count DESC
        LIMIT 10
      `);
      
      const recentlyAccessed = await this.dbAll(`
        SELECT normalized_url, method, access_count, size, accessed_at
        FROM cache_index
        ORDER BY accessed_at DESC
        LIMIT 10
      `);
      
      const largestEntries = await this.dbAll(`
        SELECT normalized_url, method, size, access_count, accessed_at
        FROM cache_index
        ORDER BY size DESC
        LIMIT 10
      `);
      
      // Get size distribution
      const sizeDistribution = await this.dbAll(`
        SELECT 
          CASE 
            WHEN size < 1024 THEN '< 1KB'
            WHEN size < 10240 THEN '1-10KB'
            WHEN size < 102400 THEN '10-100KB'
            WHEN size < 1048576 THEN '100KB-1MB'
            ELSE '> 1MB'
          END as sizeRange,
          COUNT(*) as count,
          SUM(size) as totalSize
        FROM cache_index
        GROUP BY sizeRange
        ORDER BY MIN(size)
      `);
      
      return {
        summary: {
          totalEntries: stats.totalEntries || 0,
          totalSize: stats.totalSize || 0,
          avgSize: Math.round(stats.avgSize || 0),
          maxSize: stats.maxSize || 0,
          minSize: stats.minSize || 0,
          avgAccessCount: Math.round(stats.avgAccessCount || 0),
          maxAccessCount: stats.maxAccessCount || 0
        },
        topAccessed,
        recentlyAccessed,
        largestEntries,
        sizeDistribution
      };
    } catch (error) {
      return {
        summary: {
          totalEntries: 0,
          totalSize: 0
        },
        error: error.message
      };
    }
  }

  // Cleanup old cache entries based on various strategies
  async cleanup(options = {}) {
    const {
      maxSize = null, // Maximum total cache size in bytes
      maxAge = null, // Maximum age in days
      minAccessCount = null, // Minimum access count to keep
      keepTopAccessed = 1000 // Number of top accessed entries to keep
    } = options;
    
    let deletedCount = 0;
    let deletedSize = 0;
    
    try {
      // Delete entries older than maxAge
      if (maxAge) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - maxAge);
        
        const oldEntries = await this.dbAll(`
          SELECT id, file_path, size FROM cache_index
          WHERE accessed_at < ?
        `, [cutoffDate.toISOString()]);
        
        for (const entry of oldEntries) {
          if (fs.existsSync(entry.file_path)) {
            await fs.promises.unlink(entry.file_path);
          }
          await this.dbRun('DELETE FROM cache_index WHERE id = ?', [entry.id]);
          deletedCount++;
          deletedSize += entry.size;
        }
      }
      
      // Delete entries with low access count
      if (minAccessCount) {
        const lowAccessEntries = await this.dbAll(`
          SELECT id, file_path, size FROM cache_index
          WHERE access_count < ?
          ORDER BY accessed_at ASC
        `, [minAccessCount]);
        
        for (const entry of lowAccessEntries) {
          if (fs.existsSync(entry.file_path)) {
            await fs.promises.unlink(entry.file_path);
          }
          await this.dbRun('DELETE FROM cache_index WHERE id = ?', [entry.id]);
          deletedCount++;
          deletedSize += entry.size;
        }
      }
      
      // Enforce maximum cache size
      if (maxSize) {
        const currentStats = await this.dbGet('SELECT SUM(size) as totalSize FROM cache_index');
        
        if (currentStats.totalSize > maxSize) {
          // Delete least recently accessed entries until under size limit
          const candidates = await this.dbAll(`
            SELECT id, file_path, size FROM cache_index
            ORDER BY accessed_at ASC, access_count ASC
          `);
          
          let currentSize = currentStats.totalSize;
          
          for (const entry of candidates) {
            if (currentSize <= maxSize) break;
            
            if (fs.existsSync(entry.file_path)) {
              await fs.promises.unlink(entry.file_path);
            }
            await this.dbRun('DELETE FROM cache_index WHERE id = ?', [entry.id]);
            deletedCount++;
            deletedSize += entry.size;
            currentSize -= entry.size;
          }
        }
      }
      
      // Clean up empty directories
      await this.cleanEmptyDirectories();
      
      return {
        success: true,
        deletedCount,
        deletedSize,
        message: `Cleaned up ${deletedCount} entries (${(deletedSize / 1024 / 1024).toFixed(2)} MB)`
      };
    } catch (error) {
      console.error('Error during cleanup:', error);
      return {
        success: false,
        deletedCount,
        deletedSize,
        error: error.message
      };
    }
  }

  // Close database connection
  async close() {
    if (this.db) {
      return new Promise((resolve) => {
        this.db.close((err) => {
          if (err) {
            console.error('Error closing database:', err);
          }
          resolve();
        });
      });
    }
  }
}

export default CacheManager;