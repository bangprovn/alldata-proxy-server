import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import User from '../models/user.js';
import RefreshToken from '../models/refreshToken.js';
import AuthLog from '../models/authLog.js';
import { generateAccessToken, generateRefreshToken, verifyToken, getTokenExpiry } from '../utils/jwt.js';
import { authenticateToken } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = Router();

// Validation middleware
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Get client info
const getClientInfo = (req) => ({
  ipAddress: req.ip || req.connection.remoteAddress,
  userAgent: req.headers['user-agent'],
  deviceInfo: {
    userAgent: req.headers['user-agent'],
    origin: req.headers.origin,
    referer: req.headers.referer
  }
});

// Registration endpoint
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('username').isAlphanumeric().isLength({ min: 3, max: 30 }),
  body('password').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/),
  body('licenseType').optional().isIn(['basic', 'professional', 'enterprise']),
  body('company').optional().trim(),
  body('fullName').optional().trim()
], validate, async (req, res) => {
  const clientInfo = getClientInfo(req);
  
  try {
    const { email, username, password, licenseType, company, fullName } = req.body;
    
    // Check for existing users
    const existingEmail = await User.findByEmail(email);
    if (existingEmail) {
      await AuthLog.log({
        userId: null,
        action: 'register',
        ...clientInfo,
        success: false,
        errorMessage: 'Email already registered',
        metadata: { email }
      });
      return res.status(409).json({ error: 'Email already registered' });
    }
    
    const existingUsername = await User.findByUsername(username);
    if (existingUsername) {
      await AuthLog.log({
        userId: null,
        action: 'register',
        ...clientInfo,
        success: false,
        errorMessage: 'Username already taken',
        metadata: { username }
      });
      return res.status(409).json({ error: 'Username already taken' });
    }
    
    // Create user
    const user = await User.create({ 
      email, 
      username, 
      password, 
      licenseType: licenseType || 'basic',
      company,
      fullName
    });
    
    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    
    // Save refresh token
    await RefreshToken.create({
      userId: user.id,
      token: refreshToken,
      expiresAt: getTokenExpiry(refreshToken),
      deviceInfo: clientInfo.deviceInfo
    });
    
    // Log successful registration
    await AuthLog.log({
      userId: user.id,
      action: 'register',
      ...clientInfo,
      success: true,
      metadata: { licenseType: user.license_type }
    });
    
    logger.info('User registered successfully', { userId: user.id, email: user.email });
    
    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        licenseType: user.license_type,
        apiKey: user.api_key
      },
      tokens: {
        access: accessToken,
        refresh: refreshToken
      }
    });
  } catch (error) {
    logger.error('Registration error', { error: error.message });
    await AuthLog.log({
      userId: null,
      action: 'register',
      ...clientInfo,
      success: false,
      errorMessage: error.message,
      metadata: { email: req.body.email }
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login endpoint
router.post('/login', [
  body('email').optional().isEmail().normalizeEmail(),
  body('username').optional().isAlphanumeric(),
  body('password').notEmpty()
], validate, async (req, res) => {
  const clientInfo = getClientInfo(req);
  
  try {
    const { email, username, password } = req.body;
    
    if (!password || (!email && !username)) {
      return res.status(400).json({ 
        error: 'Email/username and password are required' 
      });
    }
    
    // Find user
    let user;
    if (email) {
      user = await User.findByEmail(email);
    } else {
      user = await User.findByUsername(username);
    }
    
    if (!user) {
      await AuthLog.log({
        userId: null,
        action: 'login',
        ...clientInfo,
        success: false,
        errorMessage: 'Invalid credentials',
        metadata: { identifier: email || username }
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Check if active
    if (!user.is_active) {
      await AuthLog.log({
        userId: user.id,
        action: 'login',
        ...clientInfo,
        success: false,
        errorMessage: 'Account deactivated'
      });
      return res.status(401).json({ error: 'Account is deactivated' });
    }
    
    // Check license expiry
    if (user.license_expiry && new Date(user.license_expiry) < new Date()) {
      await AuthLog.log({
        userId: user.id,
        action: 'login',
        ...clientInfo,
        success: false,
        errorMessage: 'License expired'
      });
      return res.status(401).json({ error: 'License has expired' });
    }
    
    // Verify password
    const isValidPassword = await User.verifyPassword(password, user.password_hash);
    if (!isValidPassword) {
      await AuthLog.log({
        userId: user.id,
        action: 'login',
        ...clientInfo,
        success: false,
        errorMessage: 'Invalid password'
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Update last login
    await User.updateLastLogin(user.id);
    
    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    
    // Save refresh token
    await RefreshToken.create({
      userId: user.id,
      token: refreshToken,
      expiresAt: getTokenExpiry(refreshToken),
      deviceInfo: clientInfo.deviceInfo
    });
    
    // Log successful login
    await AuthLog.log({
      userId: user.id,
      action: 'login',
      ...clientInfo,
      success: true
    });
    
    logger.info('User logged in successfully', { userId: user.id });
    
    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        licenseType: user.license_type,
        licenseExpiry: user.license_expiry,
        apiKey: user.api_key
      },
      tokens: {
        access: accessToken,
        refresh: refreshToken
      }
    });
  } catch (error) {
    logger.error('Login error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Refresh token endpoint
router.post('/refresh', async (req, res) => {
  const clientInfo = getClientInfo(req);
  
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token is required' });
    }
    
    // Verify refresh token
    const decoded = verifyToken(refreshToken, 'refresh');
    
    // Check if token is valid
    const isValid = await RefreshToken.isValid(refreshToken);
    if (!isValid) {
      await AuthLog.log({
        userId: decoded.id,
        action: 'refresh',
        ...clientInfo,
        success: false,
        errorMessage: 'Invalid refresh token'
      });
      return res.status(401).json({ error: 'Invalid refresh token' });
    }
    
    // Get user
    const user = await User.findById(decoded.id);
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }
    
    // Check license expiry
    if (user.license_expiry && new Date(user.license_expiry) < new Date()) {
      return res.status(401).json({ error: 'License has expired' });
    }
    
    // Revoke old refresh token
    await RefreshToken.revoke(refreshToken);
    
    // Generate new tokens
    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);
    
    // Save new refresh token
    await RefreshToken.create({
      userId: user.id,
      token: newRefreshToken,
      expiresAt: getTokenExpiry(newRefreshToken),
      deviceInfo: clientInfo.deviceInfo
    });
    
    await AuthLog.log({
      userId: user.id,
      action: 'refresh',
      ...clientInfo,
      success: true
    });
    
    res.json({
      message: 'Token refreshed successfully',
      tokens: {
        access: newAccessToken,
        refresh: newRefreshToken
      }
    });
  } catch (error) {
    logger.error('Token refresh error', { error: error.message });
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// Validate token endpoint (for proxy server)
router.post('/validate', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }
    
    // Verify token
    const decoded = verifyToken(token, 'access');
    
    // Get fresh user data
    const user = await User.findById(decoded.id);
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }
    
    // Check license
    if (user.license_expiry && new Date(user.license_expiry) < new Date()) {
      return res.status(401).json({ error: 'License expired' });
    }
    
    // Check request limit
    const withinLimit = await User.checkRequestLimit(user.id);
    if (!withinLimit) {
      return res.status(429).json({ error: 'Request limit exceeded' });
    }
    
    res.json({
      valid: true,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        licenseType: user.license_type,
        licenseExpiry: user.license_expiry,
        requestsToday: user.current_requests_today,
        maxRequests: user.max_requests_per_day
      }
    });
  } catch (error) {
    res.status(401).json({ 
      valid: false, 
      error: error.message 
    });
  }
});

// Logout endpoint
router.post('/logout', authenticateToken, async (req, res) => {
  const clientInfo = getClientInfo(req);
  
  try {
    const { refreshToken } = req.body;
    
    if (refreshToken) {
      await RefreshToken.revoke(refreshToken);
    }
    
    await AuthLog.log({
      userId: req.user.id,
      action: 'logout',
      ...clientInfo,
      success: true
    });
    
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    logger.error('Logout error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API key validation endpoint
router.post('/validate-api-key', async (req, res) => {
  try {
    const { apiKey } = req.body;
    
    if (!apiKey) {
      return res.status(400).json({ error: 'API key is required' });
    }
    
    // Find user by API key
    const user = await User.findByApiKey(apiKey);
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Invalid API key' });
    }
    
    // Check license
    if (user.license_expiry && new Date(user.license_expiry) < new Date()) {
      return res.status(401).json({ error: 'License expired' });
    }
    
    // Check request limit
    const withinLimit = await User.checkRequestLimit(user.id);
    if (!withinLimit) {
      return res.status(429).json({ error: 'Request limit exceeded' });
    }
    
    // Increment request count
    await User.incrementRequestCount(user.id);
    
    res.json({
      valid: true,
      user: {
        id: user.id,
        email: user.email,
        licenseType: user.license_type,
        requestsToday: user.current_requests_today + 1,
        maxRequests: user.max_requests_per_day
      }
    });
  } catch (error) {
    res.status(401).json({ 
      valid: false, 
      error: error.message 
    });
  }
});

export default router;