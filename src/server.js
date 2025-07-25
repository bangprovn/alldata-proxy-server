import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import compression from 'compression';
import helmet from 'helmet';

import { config, validateConfig } from './config/index.js';
import { authMiddleware, authManager } from './middleware/auth.js';
import { authenticate } from './middleware/jwtAuth.js';
import { cacheMiddleware } from './middleware/cache.js';
import authRoutes from './routes/auth.js';
import cacheRoutes from './routes/cache.js';
import proxyService from './services/proxy.js';
import { 
  isStaticAsset, 
  isFontFile, 
  getContentType, 
  downloadAsset, 
  normalizeAssetPath 
} from './utils/assets.js';
import { replaceExternalLinks } from './utils/htmlProcessor.js';
import logger from './utils/logger.js';
import { handlePublicAssets, isPublicPath } from './middleware/publicAssets.js';

// Validate configuration on startup
try {
  validateConfig();
} catch (error) {
  logger.error('Configuration validation failed:', error);
  process.exit(1);
}

const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable for proxy
}));

// Compression middleware
app.use(compression());

// Logging middleware
app.use(morgan('combined', {
  stream: { write: message => logger.info(message.trim()) }
}));

// CORS middleware
app.use(cors({
  origin: true,
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'accessToken', 'web-from', 'x-api-key'],
  exposedHeaders: ['accessToken']
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static assets without authentication
app.use(handlePublicAssets);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/cache', authenticate, cacheRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// React route handler
async function handleReactRoute(req, res) {
  try {
    // First authenticate the user with JWT
    let isAuthenticated = false;
    await new Promise((resolve) => {
      authenticate(req, res, (err) => {
        if (!err) {
          isAuthenticated = true;
        }
        resolve();
      });
    });

    if (!isAuthenticated) return;

    // Then get AllData access token for proxy
    const accessToken = await authMiddleware(req, res, () => {});
    if (!accessToken) return;

    logger.info(`Fetching React app for route: ${req.path} (user: ${req.user.email})`);

    const response = await proxyService.makeRequest({
      method: 'GET',
      url: '/alldata/vehicle/home',
      headers: proxyService.buildHeaders(req, req.accessToken, false)
    });

    if (response.status === 200) {
      let html = typeof response.data === 'string' ? response.data : response.data.toString();
      
      // Update asset paths to use local proxy
      html = html.replace(/href="\/assets\//g, 'href="/assets/');
      html = html.replace(/src="\/assets\//g, 'src="/assets/');
      html = html.replace('href="https://data-eu.partnership.workshopdiag.com/favicon.png"', 'href="/favicon.png"');
      
      // Inject auto-token-handler script before any other scripts
      const tokenHandlerScript = '<script src="/assets/auto-token-handler.js"></script>';
      if (html.includes('<head>')) {
        // Inject after <head> tag to ensure it loads early
        html = html.replace('<head>', `<head>\n${tokenHandlerScript}`);
      } else if (html.includes('</body>')) {
        // Fallback: inject before </body>
        html = html.replace('</body>', `${tokenHandlerScript}\n</body>`);
      }
      
      // Handle hash-based routing
      if (req.originalUrl.includes('#')) {
        const hashPart = req.originalUrl.substring(req.originalUrl.indexOf('#'));
        const hashScript = `
          <script>
            (function() {
              if (!window.location.hash && '${hashPart}') {
                window.location.hash = '${hashPart}';
              }
            })();
          </script>
        `;
        html = html.replace('</body>', `${hashScript}</body>`);
      }
      
      // Replace external links
      html = replaceExternalLinks(html);
      
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(html);
    } else {
      res.status(response.status).send(response.data);
    }
  } catch (error) {
    logger.error('Error handling React route:', error);
    res.status(500).json({ error: 'Failed to load application' });
  }
}

// Static asset handler
async function handleStaticAsset(req, res) {
  try {
    const normalizedPath = normalizeAssetPath(req.path);
    const localPath = path.join(config.paths.public, normalizedPath);
    
    // Check if file exists locally
    if (fs.existsSync(localPath)) {
      const userInfo = req.user ? `(user: ${req.user.email})` : '(public)';
      logger.debug(`Serving cached static asset: ${localPath} ${userInfo}`);
      
      const contentType = getContentType(localPath);
      res.setHeader('Content-Type', contentType);
      
      if (isFontFile(localPath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        res.setHeader('Access-Control-Allow-Origin', '*');
      }
      
      // For HTML files, inject the auto-token-handler script
      if (contentType === 'text/html') {
        fs.readFile(localPath, 'utf8', (err, htmlContent) => {
          if (err) {
            logger.debug(`Failed to read file ${localPath}: ${err.message}`);
            return res.status(404).send('Not Found');
          }
          
          // Replace external links
          htmlContent = replaceExternalLinks(htmlContent);
          
          // Inject auto-token-handler script
          const tokenHandlerScript = '<script src="/assets/auto-token-handler.js"></script>';
          if (htmlContent.includes('<head>')) {
            htmlContent = htmlContent.replace('<head>', `<head>\n${tokenHandlerScript}`);
          } else if (htmlContent.includes('</body>')) {
            htmlContent = htmlContent.replace('</body>', `${tokenHandlerScript}\n</body>`);
          }
          
          res.send(htmlContent);
        });
        return;
      }
      
      return res.sendFile(localPath, (err) => {
        if (err) {
          logger.debug(`Failed to send file ${localPath}: ${err.message}`);
          res.status(404).send('Not Found');
        }
      });
    }
    
    // Asset doesn't exist locally, download from AllData with authentication
    // Note: AllData requires authentication even for static assets like CSS/JS
    logger.info(`Downloading static asset with auth: ${req.path}`);
    
    try {
      // Get access token
      const accessToken = await authManager.getValidToken();
      
      // Download with authentication
      const response = await proxyService.makeRequest({
        method: 'GET',
        url: req.originalUrl,
        headers: proxyService.buildHeaders(req, accessToken, false),
        responseType: 'stream'
      });
      
      logger.debug(`Response status for ${req.path}: ${response.status}`);
      
      // Handle 304 Not Modified - serve from cache if available
      if (response.status === 304) {
        logger.info(`Got 304 for ${req.path}, attempting to serve from cache`);
        
        // Check if we have it cached locally
        if (fs.existsSync(localPath)) {
          const contentType = getContentType(localPath);
          res.setHeader('Content-Type', contentType);
          res.setHeader('Cache-Control', 'public, max-age=3600');
          
          // For HTML files, inject the auto-token-handler script
          if (contentType === 'text/html') {
            fs.readFile(localPath, 'utf8', (err, htmlContent) => {
              if (err) {
                logger.error(`Failed to read cached file ${localPath}: ${err.message}`);
                return res.status(500).send('Internal Server Error');
              }
              
              // Inject auto-token-handler script
              const tokenHandlerScript = '<script src="/assets/auto-token-handler.js"></script>';
              if (htmlContent.includes('<head>')) {
                htmlContent = htmlContent.replace('<head>', `<head>\n${tokenHandlerScript}`);
              } else if (htmlContent.includes('</body>')) {
                htmlContent = htmlContent.replace('</body>', `${tokenHandlerScript}\n</body>`);
              }
              
              res.send(htmlContent);
            });
          } else {
            res.sendFile(localPath);
          }
          return;
        } else {
          logger.warn(`Got 304 but no cached file for ${req.path}`);
          return res.status(404).send('Not Found');
        }
      }
      
      if (response.status === 200) {
        // Save the asset locally
        const dir = path.dirname(localPath);
        if (!fs.existsSync(dir)) {
          await fs.promises.mkdir(dir, { recursive: true });
        }
        
        const writer = fs.createWriteStream(localPath);
        const { stream1, stream2 } = proxyService.createDuplicateStream(response.data);
        
        // Save to file
        stream1.pipe(writer);
        
        writer.on('finish', () => {
          logger.info(`Static asset saved locally: ${localPath}`);
        });
        
        // Send to client
        const contentType = getContentType(localPath);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        
        // For HTML files, inject the auto-token-handler script
        if (contentType === 'text/html') {
          let htmlContent = '';
          stream2.on('data', chunk => {
            htmlContent += chunk.toString();
          });
          
          stream2.on('end', () => {
            // Replace external links
            htmlContent = replaceExternalLinks(htmlContent);
            
            // Inject auto-token-handler script
            const tokenHandlerScript = '<script src="/assets/auto-token-handler.js"></script>';
            if (htmlContent.includes('<head>')) {
              htmlContent = htmlContent.replace('<head>', `<head>\n${tokenHandlerScript}`);
            } else if (htmlContent.includes('</body>')) {
              htmlContent = htmlContent.replace('</body>', `${tokenHandlerScript}\n</body>`);
            }
            
            res.send(htmlContent);
          });
        } else {
          stream2.pipe(res);
        }
        return;
      } else {
        logger.warn(`Failed to download static asset: ${req.path} (status: ${response.status})`);
        
        // Don't try to send response data for error statuses as it may contain circular references
        return res.status(response.status).send('Not Found');
      }
    } catch (error) {
      logger.error(`Error downloading static asset: ${req.path}`, {
        error: error.message,
        stack: error.stack,
        url: req.originalUrl
      });
      return res.status(500).send('Failed to download asset');
    }
  } catch (error) {
    logger.error(`Failed to handle static asset ${req.path}:`, error);
    return res.status(500).send('Internal server error');
  }
}

// Main proxy handler
async function proxyRequest(req, res) {
  try {
    // First authenticate the user with JWT
    let isAuthenticated = false;
    await new Promise((resolve) => {
      authenticate(req, res, (err) => {
        if (!err) {
          isAuthenticated = true;
        }
        resolve();
      });
    });

    if (!isAuthenticated) return;

    // Then get AllData access token for proxy
    await authMiddleware(req, res, () => {});
    if (!req.accessToken) return;

    // Apply cache middleware after authentication
    await new Promise((resolve) => {
      cacheMiddleware(req, res, resolve);
    });
    
    // If cache hit, response was already sent
    if (res.headersSent) return;

    const isApiRequest = proxyService.isApiRequest(req);
    
    logger.info(`Proxying ${req.method} ${req.originalUrl} (user: ${req.user.email})`, {
      isApiRequest,
      accessToken: req.accessToken ? `${req.accessToken.substring(0, 20)}...` : 'Missing'
    });

    // Build request options
    const requestOptions = {
      method: req.method,
      url: req.originalUrl,
      headers: proxyService.buildHeaders(req, req.accessToken, isApiRequest),
      data: req.body,
      responseType: isApiRequest ? 'json' : 'stream'
    };

    // Make proxy request
    const response = await proxyService.makeRequest(requestOptions);
    
    logger.info(`Proxy response: ${response.status} for ${req.originalUrl}`);

    // Set response status
    res.status(response.status);
    
    // Forward response headers
    Object.keys(response.headers).forEach(key => {
      if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(key.toLowerCase())) {
        res.setHeader(key, response.headers[key]);
      }
    });

    // Handle font files
    if (isFontFile(req.path) && response.status === 200) {
      const normalizedPath = normalizeAssetPath(req.path);
      const localPath = path.join(config.paths.public, normalizedPath);
      const dir = path.dirname(localPath);
      
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
      }
      
      const contentType = getContentType(normalizedPath);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      res.setHeader('Access-Control-Allow-Origin', '*');
      
      // Duplicate stream for saving and sending
      const { stream1, stream2 } = proxyService.createDuplicateStream(response.data);
      
      // Save to file
      const writeStream = fs.createWriteStream(localPath);
      stream1.pipe(writeStream);
      
      writeStream.on('finish', () => {
        logger.info(`Font saved locally: ${localPath}`);
      });
      
      // Send to client
      stream2.pipe(res);
    } else if (isApiRequest && response.status === 200 && res.saveToCache) {
      // Save to cache for API requests
      await res.saveToCache(response.data);
      res.json(response.data);
    } else {
      // Handle other responses
      if (response.data && typeof response.data.pipe === 'function') {
        response.data.pipe(res);
      } else {
        res.json(response.data);
      }
    }
  } catch (error) {
    logger.error('Proxy error:', {
      error: error.message,
      url: req.originalUrl,
      stack: config.server.env === 'development' ? error.stack : undefined
    });
    
    res.status(500).json({ 
      error: 'Proxy error', 
      message: error.message,
      stack: config.server.env === 'development' ? error.stack : undefined
    });
  }
}

// Main request handler
app.use(async (req, res) => {
  // Skip API endpoints
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }

  // Handle all static assets (now all are public without auth)
  // This includes HTML files and files with underscore pattern like _html
  if (isStaticAsset(req.path) || isPublicPath(req.path)) {
    return handleStaticAsset(req, res);
  }

  // Handle HTML article routes (e.g., /vehicle/.../articles/..._html/type/text/html)
  if (req.path.includes('/articles/') && req.path.includes('_html') && req.path.includes('/type/text/html')) {
    logger.debug(`Handling HTML article route: ${req.path}`);
    return handleStaticAsset(req, res);
  }

  // Handle React routes
  if (req.path.match(/^\/alldata\/vehicle\/(home|search|details)/)) {
    return handleReactRoute(req, res);
  }

  // Handle all other requests with proxy
  return proxyRequest(req, res);
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', {
    error: err.message,
    stack: err.stack,
    url: req.originalUrl
  });
  
  res.status(500).json({ 
    error: 'Internal server error',
    message: config.server.env === 'development' ? err.message : undefined
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

// Start server
const server = app.listen(config.server.port, () => {
  logger.info(`Proxy server running on http://localhost:${config.server.port}`);
  logger.info(`Proxying requests to ${config.proxy.target}`);
  logger.info(`Environment: ${config.server.env}`);
  logger.info(`Cache directory: ${config.paths.cache}`);
  logger.info(`Public directory: ${config.paths.public}`);
});

export default app;