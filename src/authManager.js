import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AUTH_URL = 'https://api.partnership.workshopdiag.com/auth/customer/login';
const REFRESH_URL = 'https://api.partnership.workshopdiag.com/auth/customer/refresh-token';
const TOKEN_CACHE_FILE = path.join(__dirname, '..', '.alldata_token_cache.json');

class AuthManager {
  constructor(email, password) {
    this.email = email;
    this.password = password;
    this.cachedToken = null;
    this.loadCachedToken();
  }

  async loadCachedToken() {
    try {
      const data = await fs.readFile(TOKEN_CACHE_FILE, 'utf8');
      const token = JSON.parse(data);
      if (this.isTokenValid(token)) {
        this.cachedToken = token;
      }
    } catch (error) {
      // Cache file doesn't exist or is invalid
    }
  }

  async saveCachedToken(token) {
    try {
      await fs.writeFile(TOKEN_CACHE_FILE, JSON.stringify(token, null, 2));
      await fs.chmod(TOKEN_CACHE_FILE, 0o600);
    } catch (error) {
      console.error('Failed to save token cache:', error);
    }
  }

  isTokenValid(token) {
    if (!token || !token.issuedAt) return false;
    
    const now = Date.now();
    const issuedAt = new Date(token.issuedAt).getTime();
    const accessTokenExpiry = issuedAt + token.expiresInAccessToken;
    
    return now < accessTokenExpiry;
  }

  isRefreshTokenValid(token) {
    if (!token || !token.issuedAt) return false;
    
    const now = Date.now();
    const issuedAt = new Date(token.issuedAt).getTime();
    const refreshTokenExpiry = issuedAt + token.expiresInRefreshToken;
    
    return now < refreshTokenExpiry;
  }

  async login() {
    try {
      const response = await axios.post(AUTH_URL, {
        email: this.email,
        password: this.password
      }, {
        headers: {
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Connection': 'keep-alive',
          'Origin': 'https://partnership.workshopdiag.com',
          'Referer': 'https://partnership.workshopdiag.com/',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-site',
          'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
          'content-type': 'application/json',
          'sec-ch-ua': '"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"',
          'sec-ch-ua-mobile': '?1',
          'sec-ch-ua-platform': '"Android"'
        }
      });

      if (response.data.statusCode !== 201) {
        throw new Error(`Login failed with status code: ${response.data.statusCode}`);
      }

      const token = {
        accessToken: response.data.data.accessToken,
        refreshToken: response.data.data.refreshToken,
        expiresInAccessToken: response.data.data.expiresInAccessToken,
        expiresInRefreshToken: response.data.data.expiresInRefreshToken,
        issuedAt: new Date().toISOString(),
        customerData: response.data.data.customer
      };

      this.cachedToken = token;
      await this.saveCachedToken(token);

      return token.accessToken;
    } catch (error) {
      throw new Error(`Login failed: ${error.message}`);
    }
  }

  async refreshToken() {
    if (!this.cachedToken || !this.isRefreshTokenValid(this.cachedToken)) {
      throw new Error('No valid refresh token available');
    }

    try {
      const response = await axios.patch(REFRESH_URL, {}, {
        headers: {
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Connection': 'keep-alive',
          'Origin': 'https://partnership.workshopdiag.com',
          'Referer': 'https://partnership.workshopdiag.com/',
          'Authorization': `Bearer ${this.cachedToken.refreshToken}`,
          'content-type': 'application/json'
        }
      });

      if (response.data.statusCode !== 201) {
        throw new Error(`Token refresh failed with status code: ${response.data.statusCode}`);
      }

      const token = {
        accessToken: response.data.data.accessToken,
        refreshToken: response.data.data.refreshToken,
        expiresInAccessToken: response.data.data.expiresInAccessToken,
        expiresInRefreshToken: response.data.data.expiresInRefreshToken,
        issuedAt: new Date().toISOString(),
        customerData: response.data.data.customer
      };

      this.cachedToken = token;
      await this.saveCachedToken(token);

      return token.accessToken;
    } catch (error) {
      throw new Error(`Token refresh failed: ${error.message}`);
    }
  }

  async getValidToken() {
    console.log('getValidToken called');
    
    // Check if we have a valid cached token
    if (this.cachedToken && this.isTokenValid(this.cachedToken)) {
      console.log('Using cached token');
      return this.cachedToken.accessToken;
    }

    // Try to refresh if we have a valid refresh token
    if (this.cachedToken && this.isRefreshTokenValid(this.cachedToken)) {
      try {
        console.log('Attempting to refresh token');
        return await this.refreshToken();
      } catch (error) {
        console.warn('Token refresh failed, falling back to login:', error.message);
      }
    }

    // Fall back to login
    console.log('No valid token, attempting login with:', this.email ? 'email provided' : 'no email');
    return await this.login();
  }

  async clearCache() {
    this.cachedToken = null;
    try {
      await fs.unlink(TOKEN_CACHE_FILE);
    } catch (error) {
      // File might not exist
    }
  }
}

export default AuthManager;