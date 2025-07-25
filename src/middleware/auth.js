import AuthManager from '../authManager.js';
import { config } from '../config/index.js';

const authManager = new AuthManager(config.auth.email, config.auth.password);

export async function authMiddleware(req, res, next) {
  try {
    const accessToken = await authManager.getValidToken();
    req.accessToken = accessToken;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({
      error: 'Authentication failed',
      details: error.message
    });
  }
}

export { authManager };