import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import compression from 'compression';
import helmet from 'helmet';

import { config, validateConfig } from './config/index.js';
import { authMiddleware } from './middleware/auth.js';
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
import logger from './utils/logger.js';

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
  credentials: true
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files from public directory
app.use(express.static(config.paths.public, {
  maxAge: '1y',
  etag: true
}));

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
      logger.debug(`Serving cached static asset: ${localPath}`);
      
      const contentType = getContentType(localPath);
      res.setHeader('Content-Type', contentType);
      
      if (isFontFile(localPath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        res.setHeader('Access-Control-Allow-Origin', '*');
      }
      
      return res.sendFile(localPath);
    }
    
    // Download and save the asset
    logger.info(`Downloading static asset: ${req.path}`);
    
    await downloadAsset(req.originalUrl, localPath);
    logger.info(`Successfully downloaded: ${localPath}`);
    
    const contentType = getContentType(localPath);
    res.setHeader('Content-Type', contentType);
    
    if (isFontFile(localPath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    
    res.sendFile(localPath);
  } catch (error) {
    logger.error(`Failed to handle static asset ${req.path}:`, error);
    // Continue with proxy logic
    return proxyRequest(req, res);
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
app.use(cacheMiddleware);

app.use(async (req, res) => {
  // Skip API endpoints
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }

  // Handle React routes
  if (req.path.match(/^\/alldata\/vehicle\/(home|search|details)/)) {
    return handleReactRoute(req, res);
  }

  // Handle static assets
  if (isStaticAsset(req.path) && !req.path.includes('/fonts/')) {
    return handleStaticAsset(req, res);
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