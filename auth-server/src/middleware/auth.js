import { verifyToken } from '../utils/jwt.js';
import User from '../models/user.js';
import AuthLog from '../models/authLog.js';
import logger from '../utils/logger.js';

export const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      error: 'Access token required',
      code: 'NO_TOKEN'
    });
  }

  try {
    const decoded = verifyToken(token, 'access');
    
    // Get fresh user data
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ 
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }
    
    if (!user.is_active) {
      return res.status(401).json({ 
        error: 'User account is deactivated',
        code: 'USER_DEACTIVATED'
      });
    }
    
    // Check license expiry
    if (user.license_expiry && new Date(user.license_expiry) < new Date()) {
      return res.status(401).json({ 
        error: 'License has expired',
        code: 'LICENSE_EXPIRED'
      });
    }
    
    req.user = {
      id: user.id,
      email: user.email,
      username: user.username,
      licenseType: user.license_type
    };
    
    next();
  } catch (error) {
    logger.error('Token verification failed', { error: error.message });
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Token expired',
        code: 'TOKEN_EXPIRED'
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        error: 'Invalid token',
        code: 'INVALID_TOKEN'
      });
    }
    
    return res.status(401).json({ 
      error: 'Authentication failed',
      code: 'AUTH_FAILED'
    });
  }
};

export const requireAdmin = (req, res, next) => {
  if (req.user.licenseType !== 'enterprise') {
    return res.status(403).json({ 
      error: 'Admin access required',
      code: 'INSUFFICIENT_PRIVILEGES'
    });
  }
  next();
};

export const rateLimitByIP = async (req, res, next) => {
  const ipAddress = req.ip || req.connection.remoteAddress;
  
  try {
    const failedAttempts = await AuthLog.getFailedAttempts(ipAddress, 15);
    
    if (failedAttempts > 5) {
      return res.status(429).json({ 
        error: 'Too many failed attempts. Please try again later.',
        code: 'TOO_MANY_ATTEMPTS'
      });
    }
    
    next();
  } catch (error) {
    logger.error('Rate limit check error', { error: error.message });
    next();
  }
};