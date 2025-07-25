#!/usr/bin/env node

/**
 * Demo script showing refresh token usage
 * Run: node token-refresh-demo.js
 */

import axios from 'axios';

const AUTH_SERVER = process.env.AUTH_SERVER_URL || 'http://localhost:3001';
const PROXY_SERVER = process.env.PROXY_SERVER_URL || 'http://localhost:3000';

class TokenManager {
  constructor() {
    this.tokens = null;
  }

  async register(email, username, password) {
    try {
      const response = await axios.post(`${AUTH_SERVER}/api/auth/register`, {
        email,
        username,
        password,
        licenseType: 'basic'
      });
      
      this.tokens = response.data.tokens;
      console.log('✅ Registration successful');
      console.log(`   User ID: ${response.data.user.id}`);
      console.log(`   API Key: ${response.data.user.apiKey}`);
      return response.data;
    } catch (error) {
      if (error.response?.status === 409) {
        console.log('ℹ️  User already exists, trying login...');
        return this.login(email, password);
      }
      throw error;
    }
  }

  async login(email, password) {
    const response = await axios.post(`${AUTH_SERVER}/api/auth/login`, {
      email,
      password
    });
    
    this.tokens = response.data.tokens;
    console.log('✅ Login successful');
    return response.data;
  }

  async refreshTokens() {
    if (!this.tokens?.refresh) {
      throw new Error('No refresh token available');
    }

    console.log('🔄 Refreshing tokens...');
    const response = await axios.post(`${AUTH_SERVER}/api/auth/refresh`, {
      refreshToken: this.tokens.refresh
    });
    
    this.tokens = response.data.tokens;
    console.log('✅ Tokens refreshed successfully');
    return this.tokens;
  }

  async makeAuthenticatedRequest(url) {
    if (!this.tokens?.access) {
      throw new Error('No access token available');
    }

    try {
      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${this.tokens.access}`
        }
      });
      return response.data;
    } catch (error) {
      if (error.response?.status === 401) {
        console.log('⚠️  Access token expired, refreshing...');
        await this.refreshTokens();
        
        // Retry request with new token
        const response = await axios.get(url, {
          headers: {
            'Authorization': `Bearer ${this.tokens.access}`
          }
        });
        return response.data;
      }
      throw error;
    }
  }

  parseJWT(token) {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      Buffer.from(base64, 'base64')
        .toString()
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  }

  showTokenInfo() {
    if (!this.tokens) {
      console.log('❌ No tokens available');
      return;
    }

    console.log('\n📊 Token Information:');
    
    if (this.tokens.access) {
      const accessPayload = this.parseJWT(this.tokens.access);
      const accessExp = new Date(accessPayload.exp * 1000);
      console.log('\nAccess Token:');
      console.log(`  - User ID: ${accessPayload.id}`);
      console.log(`  - Email: ${accessPayload.email}`);
      console.log(`  - License: ${accessPayload.licenseType}`);
      console.log(`  - Expires: ${accessExp.toLocaleString()}`);
      console.log(`  - Time left: ${Math.round((accessExp - new Date()) / 1000)}s`);
    }

    if (this.tokens.refresh) {
      const refreshPayload = this.parseJWT(this.tokens.refresh);
      const refreshExp = new Date(refreshPayload.exp * 1000);
      console.log('\nRefresh Token:');
      console.log(`  - Expires: ${refreshExp.toLocaleString()}`);
      console.log(`  - Time left: ${Math.round((refreshExp - new Date()) / 1000 / 86400)} days`);
    }
  }

  async logout() {
    if (!this.tokens) return;

    try {
      await axios.post(`${AUTH_SERVER}/api/auth/logout`, {
        refreshToken: this.tokens.refresh
      }, {
        headers: {
          'Authorization': `Bearer ${this.tokens.access}`
        }
      });
      console.log('✅ Logged out successfully');
    } catch (error) {
      console.log('⚠️  Logout error:', error.message);
    }

    this.tokens = null;
  }
}

// Demo flow
async function runDemo() {
  const tokenManager = new TokenManager();
  
  // Test credentials
  const email = `test${Date.now()}@example.com`;
  const username = `testuser${Date.now()}`;
  const password = 'TestPass123!';

  try {
    console.log('🚀 Starting Refresh Token Demo\n');
    
    // 1. Register/Login
    await tokenManager.register(email, username, password);
    tokenManager.showTokenInfo();

    // 2. Make authenticated request
    console.log('\n📡 Making authenticated request to proxy...');
    const health = await tokenManager.makeAuthenticatedRequest(`${PROXY_SERVER}/api/health`);
    console.log('✅ Health check response:', health);

    // 3. Wait and show token age
    console.log('\n⏳ Waiting 5 seconds...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    tokenManager.showTokenInfo();

    // 4. Manually refresh tokens
    await tokenManager.refreshTokens();
    console.log('\n🔄 After manual refresh:');
    tokenManager.showTokenInfo();

    // 5. Simulate expired token scenario
    console.log('\n🧪 Simulating expired token scenario...');
    const oldAccess = tokenManager.tokens.access;
    tokenManager.tokens.access = 'invalid.token.here';
    
    try {
      await tokenManager.makeAuthenticatedRequest(`${PROXY_SERVER}/api/health`);
      console.log('✅ Request succeeded with automatic token refresh');
    } catch (error) {
      console.log('❌ Request failed:', error.message);
    }

    // 6. Show final token state
    console.log('\n📊 Final token state:');
    tokenManager.showTokenInfo();

    // 7. Logout
    console.log('\n👋 Logging out...');
    await tokenManager.logout();

    console.log('\n✨ Demo completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Demo error:', error.response?.data || error.message);
    process.exit(1);
  }
}

// Run the demo
runDemo().catch(console.error);