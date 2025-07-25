# Refresh Token Implementation Guide

The auth server has a complete refresh token mechanism implemented for secure token rotation.

## How It Works

1. **Token Types**:
   - **Access Token**: Short-lived (15 minutes default), used for API requests
   - **Refresh Token**: Long-lived (7 days default), used to get new access tokens

2. **Token Rotation**: When a refresh token is used, it's immediately revoked and a new pair is issued

3. **Security Features**:
   - Refresh tokens are stored in database with revocation status
   - Device info is tracked for each refresh token
   - All token operations are audit logged
   - Expired tokens are automatically cleaned up

## API Endpoints

### 1. Login - Get Initial Tokens
```bash
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

Response:
```json
{
  "message": "Login successful",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "username": "testuser",
    "licenseType": "professional",
    "apiKey": "eyJ..."
  },
  "tokens": {
    "access": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refresh": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

### 2. Refresh Token - Get New Access Token
```bash
POST /api/auth/refresh
Content-Type: application/json

{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

Response:
```json
{
  "message": "Token refreshed successfully",
  "tokens": {
    "access": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refresh": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

### 3. Logout - Revoke Refresh Token
```bash
POST /api/auth/logout
Authorization: Bearer ACCESS_TOKEN
Content-Type: application/json

{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### 4. Logout All Sessions
```bash
POST /api/users/logout-all
Authorization: Bearer ACCESS_TOKEN
```

This revokes all refresh tokens for the user.

## Client Implementation Example

### JavaScript/Axios
```javascript
class AuthService {
  constructor() {
    this.baseURL = 'http://localhost:3001/api';
    this.tokens = this.loadTokens();
    
    // Setup axios interceptor for token refresh
    this.setupInterceptors();
  }
  
  setupInterceptors() {
    // Request interceptor to add token
    axios.interceptors.request.use(
      config => {
        if (this.tokens?.access) {
          config.headers.Authorization = `Bearer ${this.tokens.access}`;
        }
        return config;
      },
      error => Promise.reject(error)
    );
    
    // Response interceptor to handle token expiry
    axios.interceptors.response.use(
      response => response,
      async error => {
        const originalRequest = error.config;
        
        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;
          
          try {
            const newTokens = await this.refreshToken();
            originalRequest.headers.Authorization = `Bearer ${newTokens.access}`;
            return axios(originalRequest);
          } catch (refreshError) {
            this.logout();
            window.location.href = '/login';
            return Promise.reject(refreshError);
          }
        }
        
        return Promise.reject(error);
      }
    );
  }
  
  async login(email, password) {
    const response = await axios.post(`${this.baseURL}/auth/login`, {
      email,
      password
    });
    
    this.tokens = response.data.tokens;
    this.saveTokens(this.tokens);
    return response.data;
  }
  
  async refreshToken() {
    if (!this.tokens?.refresh) {
      throw new Error('No refresh token available');
    }
    
    const response = await axios.post(`${this.baseURL}/auth/refresh`, {
      refreshToken: this.tokens.refresh
    });
    
    this.tokens = response.data.tokens;
    this.saveTokens(this.tokens);
    return this.tokens;
  }
  
  async logout() {
    if (this.tokens?.refresh) {
      try {
        await axios.post(`${this.baseURL}/auth/logout`, {
          refreshToken: this.tokens.refresh
        }, {
          headers: {
            Authorization: `Bearer ${this.tokens.access}`
          }
        });
      } catch (error) {
        console.error('Logout error:', error);
      }
    }
    
    this.tokens = null;
    this.clearTokens();
  }
  
  saveTokens(tokens) {
    localStorage.setItem('auth_tokens', JSON.stringify(tokens));
  }
  
  loadTokens() {
    const stored = localStorage.getItem('auth_tokens');
    return stored ? JSON.parse(stored) : null;
  }
  
  clearTokens() {
    localStorage.removeItem('auth_tokens');
  }
}

// Usage
const auth = new AuthService();

// Login
await auth.login('user@example.com', 'password');

// Make authenticated requests - token refresh happens automatically
const response = await axios.get('http://localhost:3000/api/some-endpoint');
```

### Python Example
```python
import requests
import json
from datetime import datetime, timedelta
import jwt

class AuthService:
    def __init__(self, base_url='http://localhost:3001/api'):
        self.base_url = base_url
        self.tokens = None
        self.load_tokens()
    
    def login(self, email, password):
        response = requests.post(f'{self.base_url}/auth/login', json={
            'email': email,
            'password': password
        })
        response.raise_for_status()
        
        data = response.json()
        self.tokens = data['tokens']
        self.save_tokens()
        return data
    
    def refresh_token(self):
        if not self.tokens or 'refresh' not in self.tokens:
            raise Exception('No refresh token available')
        
        response = requests.post(f'{self.base_url}/auth/refresh', json={
            'refreshToken': self.tokens['refresh']
        })
        response.raise_for_status()
        
        data = response.json()
        self.tokens = data['tokens']
        self.save_tokens()
        return self.tokens
    
    def make_request(self, method, url, **kwargs):
        # Check if access token is expired
        if self.is_token_expired(self.tokens.get('access')):
            self.refresh_token()
        
        headers = kwargs.get('headers', {})
        headers['Authorization'] = f"Bearer {self.tokens['access']}"
        kwargs['headers'] = headers
        
        response = requests.request(method, url, **kwargs)
        
        # If 401, try refreshing token
        if response.status_code == 401:
            self.refresh_token()
            headers['Authorization'] = f"Bearer {self.tokens['access']}"
            response = requests.request(method, url, **kwargs)
        
        return response
    
    def is_token_expired(self, token):
        if not token:
            return True
        
        try:
            # Decode without verification to check expiry
            payload = jwt.decode(token, options={"verify_signature": False})
            exp = datetime.fromtimestamp(payload['exp'])
            # Refresh if less than 1 minute remaining
            return exp < datetime.now() + timedelta(minutes=1)
        except:
            return True
    
    def logout(self):
        if self.tokens and 'refresh' in self.tokens:
            try:
                requests.post(f'{self.base_url}/auth/logout', 
                    json={'refreshToken': self.tokens['refresh']},
                    headers={'Authorization': f"Bearer {self.tokens['access']}"}
                )
            except:
                pass
        
        self.tokens = None
        self.clear_tokens()
    
    def save_tokens(self):
        with open('.auth_tokens.json', 'w') as f:
            json.dump(self.tokens, f)
    
    def load_tokens(self):
        try:
            with open('.auth_tokens.json', 'r') as f:
                self.tokens = json.load(f)
        except:
            self.tokens = None
    
    def clear_tokens(self):
        try:
            import os
            os.remove('.auth_tokens.json')
        except:
            pass

# Usage
auth = AuthService()

# Login
auth.login('user@example.com', 'password')

# Make authenticated requests with automatic token refresh
response = auth.make_request('GET', 'http://localhost:3000/api/some-endpoint')
```

## Token Expiration Settings

Configure in environment variables:
- `JWT_ACCESS_EXPIRY`: Access token expiry (default: "15m")
- `JWT_REFRESH_EXPIRY`: Refresh token expiry (default: "7d")

Common values:
- Access: "15m", "30m", "1h"
- Refresh: "7d", "14d", "30d"

## Security Best Practices

1. **Store Securely**:
   - Never store tokens in cookies without HttpOnly flag
   - Use secure storage in mobile apps (Keychain/Keystore)
   - Consider using sessionStorage instead of localStorage for web

2. **Token Rotation**:
   - Always use the new refresh token after refresh
   - Old refresh tokens are immediately invalidated

3. **Monitor Sessions**:
   - Check active sessions: `GET /api/users/sessions`
   - Revoke specific session: `DELETE /api/users/sessions/:id`

4. **Handle Errors**:
   - 401 with "TOKEN_EXPIRED" - Use refresh token
   - 401 with "INVALID_TOKEN" - Re-login required
   - 429 - Rate limit exceeded, wait before retry

## Troubleshooting

### Common Issues

1. **"Invalid refresh token"**
   - Token already used (tokens are single-use)
   - Token expired (check JWT_REFRESH_EXPIRY)
   - Token revoked (user logged out)

2. **"Token expired" on every request**
   - Check if client is properly storing new tokens after refresh
   - Verify time sync between client and server

3. **Multiple 401 errors**
   - Ensure refresh logic doesn't create infinite loops
   - Add retry limit to refresh attempts

### Debug Token
```bash
# Decode token to check expiry (without verification)
echo "YOUR_TOKEN" | cut -d. -f2 | base64 -d | jq
```

## Database Maintenance

The system automatically cleans expired tokens, but you can manually trigger:
```sql
-- View active refresh tokens for a user
SELECT * FROM refresh_tokens 
WHERE user_id = 1 AND is_revoked = false AND expires_at > NOW();

-- Manually clean expired tokens
DELETE FROM refresh_tokens WHERE expires_at < NOW();
```