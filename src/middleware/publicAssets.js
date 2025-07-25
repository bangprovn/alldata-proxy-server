import express from 'express';
import path from 'path';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

// List of paths that should be publicly accessible without authentication
const PUBLIC_PATHS = [
  '/',
  '/index.html',
  '/favicon.ico',
  '/favicon.png',
  '/robots.txt',
  '/sitemap.xml'
];

// List of directories/patterns that should be publicly accessible
const PUBLIC_PATTERNS = [
  /^\/assets\//,     // All files in /assets/ directory
  /^\/css\//,        // CSS files
  /^\/js\//,         // JavaScript files
  /^\/images\//,     // Images
  /^\/fonts\//,      // Fonts
  /^\/\.well-known\// // Well-known URIs (RFC 5785)
];

/**
 * Middleware to serve static assets from public directory without authentication
 */
export const publicAssetsMiddleware = express.static(config.paths.public, {
  index: 'index.html',  // Serve index.html for directory requests
  setHeaders: (res, filePath) => {
    // Set appropriate cache headers for different file types
    const ext = path.extname(filePath).toLowerCase();

    if (['.js', '.css', '.woff', '.woff2', '.ttf', '.eot', '.otf'].includes(ext)) {
      // Long cache for versioned assets
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico'].includes(ext)) {
      // Medium cache for images
      res.setHeader('Cache-Control', 'public, max-age=86400');
    } else {
      // Short cache for HTML and other files
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }

    // CORS headers for fonts
    if (['.woff', '.woff2', '.ttf', '.eot', '.otf'].includes(ext)) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
  }
});

/**
 * Check if a path should be publicly accessible without authentication
 */
export function isPublicPath(requestPath) {
  // Remove query string for comparison
  const pathWithoutQuery = requestPath.split('?')[0];

  // Check exact paths
  if (PUBLIC_PATHS.includes(pathWithoutQuery)) {
    return true;
  }

  // Check patterns
  if (PUBLIC_PATTERNS.some(pattern => pattern.test(pathWithoutQuery))) {
    return true;
  }

  // Check if it's a static asset based on file extension
  // This allows ALL static files to be served without auth
  const STATIC_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'pdf', 'html', 'css', 'js', 'woff', 'woff2', 'ttf', 'eot', 'otf', 'ico', 'webp', 'json', 'xml', 'txt', 'map'];
  const ext = path.extname(pathWithoutQuery).toLowerCase().substring(1);

  return STATIC_EXTENSIONS.includes(ext);
}

/**
 * Middleware to handle public asset requests
 */
export function handlePublicAssets(req, res, next) {
  // Skip if not a public path
  if (!isPublicPath(req.path)) {
    return next();
  }

  logger.debug(`Serving public asset without auth: ${req.path}`);

  // Use the static middleware for public paths
  publicAssetsMiddleware(req, res, next);
}