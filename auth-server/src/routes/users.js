import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import User from '../models/user.js';
import RefreshToken from '../models/refreshToken.js';
import AuthLog from '../models/authLog.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import db from '../db/database.js';
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

// Get current user profile
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const activeSessions = await RefreshToken.getUserActiveTokens(user.id);
    
    res.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        licenseType: user.license_type,
        licenseExpiry: user.license_expiry,
        createdAt: user.created_at,
        lastLogin: user.last_login,
        fullName: user.full_name,
        company: user.company,
        apiKey: user.api_key,
        requestsToday: user.current_requests_today,
        maxRequestsPerDay: user.max_requests_per_day
      },
      activeSessions: activeSessions.length
    });
  } catch (error) {
    logger.error('Get profile error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update profile
router.put('/me', authenticateToken, [
  body('fullName').optional().trim(),
  body('company').optional().trim()
], validate, async (req, res) => {
  try {
    const { fullName, company } = req.body;
    
    const query = `
      UPDATE users
      SET full_name = COALESCE($1, full_name),
          company = COALESCE($2, company)
      WHERE id = $3
      RETURNING id, email, username, full_name, company
    `;
    
    const result = await db.query(query, [fullName, company, req.user.id]);
    
    res.json({
      message: 'Profile updated successfully',
      user: result.rows[0]
    });
  } catch (error) {
    logger.error('Update profile error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Change password
router.put('/change-password', authenticateToken, [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
], validate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    // Get user with password hash
    const user = await User.findById(req.user.id);
    
    // Verify current password
    const isValidPassword = await User.verifyPassword(currentPassword, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    
    // Update password
    await User.updatePassword(req.user.id, newPassword);
    
    // Revoke all refresh tokens
    await RefreshToken.revokeAllForUser(req.user.id);
    
    // Log password change
    await AuthLog.log({
      userId: req.user.id,
      action: 'change_password',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      success: true
    });
    
    res.json({ 
      message: 'Password changed successfully. Please login again.' 
    });
  } catch (error) {
    logger.error('Change password error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Regenerate API key
router.post('/regenerate-api-key', authenticateToken, async (req, res) => {
  try {
    const newApiKey = await User.regenerateApiKey(req.user.id);
    
    await AuthLog.log({
      userId: req.user.id,
      action: 'regenerate_api_key',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      success: true
    });
    
    res.json({
      message: 'API key regenerated successfully',
      apiKey: newApiKey
    });
  } catch (error) {
    logger.error('Regenerate API key error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user activity logs
router.get('/activity', authenticateToken, async (req, res) => {
  try {
    const logs = await AuthLog.getUserLogs(req.user.id);
    
    res.json({
      logs: logs.map(log => ({
        id: log.id,
        action: log.action,
        ipAddress: log.ip_address,
        userAgent: log.user_agent,
        success: log.success,
        errorMessage: log.error_message,
        createdAt: log.created_at
      }))
    });
  } catch (error) {
    logger.error('Get activity logs error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get active sessions
router.get('/sessions', authenticateToken, async (req, res) => {
  try {
    const sessions = await RefreshToken.getUserActiveTokens(req.user.id);
    
    res.json({
      sessions: sessions.map(session => ({
        id: session.id,
        deviceInfo: session.device_info,
        createdAt: session.created_at,
        expiresAt: session.expires_at
      }))
    });
  } catch (error) {
    logger.error('Get sessions error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Revoke specific session
router.delete('/sessions/:tokenId', authenticateToken, async (req, res) => {
  try {
    const { tokenId } = req.params;
    
    // Verify the token belongs to the user
    const query = `
      UPDATE refresh_tokens
      SET is_revoked = true
      WHERE id = $1 AND user_id = $2
      RETURNING id
    `;
    
    const result = await db.query(query, [tokenId, req.user.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    res.json({ message: 'Session revoked successfully' });
  } catch (error) {
    logger.error('Revoke session error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin: Update user license
router.put('/:userId/license', authenticateToken, requireAdmin, [
  body('licenseType').isIn(['basic', 'professional', 'enterprise']),
  body('expiryDate').optional().isISO8601()
], validate, async (req, res) => {
  try {
    const { userId } = req.params;
    const { licenseType, expiryDate } = req.body;
    
    const user = await User.updateLicense(userId, licenseType, expiryDate);
    
    await AuthLog.log({
      userId: req.user.id,
      action: 'update_user_license',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      success: true,
      metadata: { targetUserId: userId, licenseType }
    });
    
    res.json({
      message: 'License updated successfully',
      user
    });
  } catch (error) {
    logger.error('Update license error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;