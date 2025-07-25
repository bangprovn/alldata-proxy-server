import jwt from 'jsonwebtoken';
import axios from 'axios';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

// Cache for validated tokens to reduce auth server calls
const tokenCache = new Map();
const CACHE_TTL = 60 * 1000; // 1 minute

// Get auth server URL from config
const getAuthServerUrl = () => config.authServer?.url || process.env.AUTH_SERVER_URL || 'http://localhost:3001';

export const validateJWT = async (req, res, next) => {
  // Check for token in multiple places matching React app behavior
  let token = null;

  // 1. Check Authorization header (Bearer token)
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  // 2. Check accessToken header (as used by React app)
  if (!token && req.headers['accesstoken']) {
    token = req.headers['accesstoken'];
  }

  // 3. Check cookies
  if (!token && req.headers.cookie) {
    const cookies = req.headers.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'accessToken') {
        token = value;
        break;
      }
    }
  }

  if (!token) {
    return res.status(400).json({
      error: 'Access token required',
      code: 'NO_TOKEN',
      msg_code: 'NO_TOKEN'
    });
  }

  try {
    // Check cache first
    const cached = tokenCache.get(token);
    if (cached && cached.expiry > Date.now()) {
      req.user = cached.user;
      return next();
    }

    // Validate with auth server
    const response = await axios.post(`${getAuthServerUrl()}/api/auth/validate`, {
      token
    }, {
      timeout: 5000 // 5 second timeout
    });

    if (!response.data.valid) {
      return res.status(401).json({
        error: response.data.error || 'Invalid token',
        code: 'INVALID_TOKEN'
      });
    }

    // Cache the validation result
    tokenCache.set(token, {
      user: response.data.user,
      expiry: Date.now() + CACHE_TTL
    });

    // Clean old cache entries periodically
    if (tokenCache.size > 1000) {
      const now = Date.now();
      for (const [key, value] of tokenCache.entries()) {
        if (value.expiry < now) {
          tokenCache.delete(key);
        }
      }
    }

    req.user = response.data.user;
    next();
  } catch (error) {
    logger.error('JWT validation error', {
      error: error.message,
      authServerUrl: getAuthServerUrl()
    });

    // If auth server is down, try local validation as fallback
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      try {
        const decoded = jwt.verify(token, config.jwt.secret, {
          issuer: config.jwt.issuer || 'alldata-auth-server'
        });

        if (decoded.type !== 'access') {
          throw new Error('Invalid token type');
        }

        // Basic validation passed, but we can't check user status or limits
        req.user = {
          id: decoded.id,
          email: decoded.email,
          username: decoded.username,
          licenseType: decoded.licenseType
        };

        logger.warn('Auth server unavailable, using fallback JWT validation', {
          userId: decoded.id
        });

        next();
      } catch {
        return res.status(401).json({
          error: 'Authentication failed',
          code: 'AUTH_FAILED'
        });
      }
    } else if (error.response?.status === 429) {
      return res.status(429).json({
        error: 'Request limit exceeded',
        code: 'RATE_LIMIT_EXCEEDED'
      });
    } else {
      return res.status(401).json({
        error: 'Authentication failed',
        code: 'AUTH_FAILED'
      });
    }
  }
};

export const validateAPIKey = async (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;

  if (!apiKey) {
    return res.status(401).json({
      error: 'API key required',
      code: 'NO_API_KEY'
    });
  }

  try {
    // Validate with auth server
    const response = await axios.post(`${getAuthServerUrl()}/api/auth/validate-api-key`, {
      apiKey
    }, {
      timeout: 5000
    });

    if (!response.data.valid) {
      return res.status(401).json({
        error: response.data.error || 'Invalid API key',
        code: 'INVALID_API_KEY'
      });
    }

    req.user = response.data.user;
    next();
  } catch (error) {
    logger.error('API key validation error', { error: error.message });

    if (error.response?.status === 429) {
      return res.status(429).json({
        error: 'Request limit exceeded',
        code: 'RATE_LIMIT_EXCEEDED'
      });
    }

    return res.status(401).json({
      error: 'Authentication failed',
      code: 'AUTH_FAILED'
    });
  }
};

// Middleware to use either JWT or API key
export const authenticate = async (req, res, next) => {
  const hasAuthHeader = req.headers['authorization'];
  const hasAccessToken = req.headers['accesstoken'];
  const hasApiKey = req.headers['x-api-key'] || req.query.apiKey;
  const hasCookieToken = req.headers.cookie && req.headers.cookie.includes('accessToken=');

  if (hasAuthHeader || hasAccessToken || hasCookieToken) {
    return validateJWT(req, res, next);
  } else if (hasApiKey) {
    return validateAPIKey(req, res, next);
  } else {
    return res.status(400).json({
      error: 'Authentication required',
      code: 'NO_AUTH',
      msg_code: 'NO_TOKEN'
    });
  }
};

export default {
  validateJWT,
  validateAPIKey,
  authenticate
};