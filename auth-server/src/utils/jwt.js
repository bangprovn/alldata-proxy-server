import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import logger from './logger.js';

export const generateAccessToken = (user) => {
  const payload = {
    id: user.id,
    email: user.email,
    username: user.username,
    licenseType: user.license_type,
    licenseExpiry: user.license_expiry,
    maxRequestsPerDay: user.max_requests_per_day,
    type: 'access'
  };
  
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.accessTokenExpiry,
    issuer: config.jwt.issuer,
    subject: user.id.toString()
  });
};

export const generateRefreshToken = (user) => {
  const payload = {
    id: user.id,
    type: 'refresh'
  };
  
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.refreshTokenExpiry,
    issuer: config.jwt.issuer,
    subject: user.id.toString()
  });
};

export const generateApiKey = (user) => {
  const payload = {
    id: user.id,
    email: user.email,
    licenseType: user.license_type,
    type: 'api'
  };
  
  return jwt.sign(payload, config.jwt.secret, {
    issuer: config.jwt.issuer,
    subject: user.id.toString()
  });
};

export const verifyToken = (token, type = 'access') => {
  try {
    const decoded = jwt.verify(token, config.jwt.secret, {
      issuer: config.jwt.issuer
    });
    
    if (decoded.type !== type) {
      throw new Error(`Invalid token type. Expected ${type}, got ${decoded.type}`);
    }
    
    return decoded;
  } catch (error) {
    logger.error('JWT verification failed', { error: error.message, type });
    throw error;
  }
};

export const decodeToken = (token) => {
  return jwt.decode(token);
};

export const getTokenExpiry = (token) => {
  const decoded = decodeToken(token);
  if (!decoded || !decoded.exp) {
    return null;
  }
  return new Date(decoded.exp * 1000);
};

export const validateLicense = (decoded) => {
  if (!decoded.licenseType) {
    throw new Error('No license type found in token');
  }
  
  if (decoded.licenseExpiry && new Date(decoded.licenseExpiry) < new Date()) {
    throw new Error('License has expired');
  }
  
  return true;
};

export default {
  generateAccessToken,
  generateRefreshToken,
  generateApiKey,
  verifyToken,
  decodeToken,
  getTokenExpiry,
  validateLicense
};