import { Router } from 'express';
import AuthManager from '../authManager.js';
import { authManager } from '../middleware/auth.js';

const router = Router();

// Login endpoint
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    const tempAuthManager = new AuthManager(email, password);
    const token = await tempAuthManager.login();

    res.json({
      success: true,
      accessToken: token
    });
  } catch (error) {
    res.status(401).json({
      success: false,
      error: error.message
    });
  }
});

// Refresh token endpoint
router.post('/refresh', async (req, res) => {
  try {
    const token = await authManager.refreshToken();
    res.json({
      success: true,
      accessToken: token
    });
  } catch (error) {
    res.status(401).json({
      success: false,
      error: error.message
    });
  }
});

// Test token endpoint
router.get('/test-token', async (req, res) => {
  try {
    const accessToken = await authManager.getValidToken();
    const axios = (await import('axios')).default;

    const response = await axios.get('https://data-eu.partnership.workshopdiag.com/', {
      headers: {
        'Cookie': `accessToken=${accessToken}`,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      validateStatus: () => true
    });

    res.json({
      tokenValid: response.status === 200,
      status: response.status,
      tokenPreview: accessToken.substring(0, 20) + '...',
      headers: response.headers,
      dataLength: response.data ? response.data.length : 0
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

export default router;