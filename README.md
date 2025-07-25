# AllData Proxy Server with Authentication

A microservices architecture with separate authentication and proxy servers for the AllData EU API.

## Architecture

The system consists of two main services:

1. **Auth Server** (Port 3001) - Handles user authentication, JWT tokens, and license management
2. **Proxy Server** (Port 3000) - Validates JWT tokens and proxies requests to AllData API

## Features

### Auth Server
- User registration and login with JWT tokens
- License-based access control (Basic, Professional, Enterprise)
- API key generation for programmatic access
- Request rate limiting based on license type
- PostgreSQL database for user storage
- Audit logging for security events
- Token refresh mechanism

### Proxy Server
- JWT token validation via auth server
- AllData API proxy with authentication
- Response caching with SQLite
- Static asset handling
- Automatic token validation caching

## Quick Start

### Using Docker Compose

1. Create a `.env` file:
```env
# AllData credentials
ALLDATA_EMAIL=your_email@example.com
ALLDATA_PASSWORD=your_password

# Security - Change these!
JWT_SECRET=your_secure_jwt_secret_key
AUTH_DB_PASSWORD=secure_database_password
```

2. Start all services:
```bash
docker-compose up -d
```

This will start:
- PostgreSQL database (port 5432)
- Auth server (port 3001)
- Proxy server (port 3000)

### Manual Setup

#### Auth Server
```bash
cd auth-server
npm install
npm start
```

#### Proxy Server
```bash
npm install
npm start
```

## API Usage

### 1. Register a new user
```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "username": "testuser",
    "password": "SecurePass123",
    "licenseType": "professional"
  }'
```

Response includes JWT tokens and API key:
```json
{
  "user": {
    "id": 1,
    "email": "user@example.com",
    "username": "testuser",
    "licenseType": "professional",
    "apiKey": "eyJ..."
  },
  "tokens": {
    "access": "eyJ...",
    "refresh": "eyJ..."
  }
}
```

### 2. Login
```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123"
  }'
```

### 3. Use the proxy with JWT
```bash
curl http://localhost:3000/any/alldata/endpoint \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### 4. Use the proxy with API key
```bash
curl http://localhost:3000/any/alldata/endpoint \
  -H "X-API-Key: YOUR_API_KEY"
```

## License Types

| License | Daily Requests | Features |
|---------|----------------|----------|
| Basic | 1,000 | API access only |
| Professional | 10,000 | API + Cache access |
| Enterprise | 100,000 | All features + Priority support |

## Environment Variables

### Auth Server
- `PORT` - Server port (default: 3001)
- `DB_HOST` - PostgreSQL host
- `DB_PORT` - PostgreSQL port
- `DB_NAME` - Database name
- `DB_USER` - Database user
- `DB_PASSWORD` - Database password
- `JWT_SECRET` - Secret key for JWT signing
- `JWT_ISSUER` - JWT issuer name

### Proxy Server
- `PORT` - Server port (default: 3000)
- `ALLDATA_EMAIL` - AllData account email
- `ALLDATA_PASSWORD` - AllData account password
- `AUTH_SERVER_URL` - Auth server URL
- `JWT_SECRET` - Must match auth server
- `JWT_ISSUER` - Must match auth server

## User Management API

### Get Profile
```bash
GET /api/users/me
Authorization: Bearer TOKEN
```

### Change Password
```bash
PUT /api/users/change-password
Authorization: Bearer TOKEN
{
  "currentPassword": "old",
  "newPassword": "new"
}
```

### Regenerate API Key
```bash
POST /api/users/regenerate-api-key
Authorization: Bearer TOKEN
```

### View Activity Logs
```bash
GET /api/users/activity
Authorization: Bearer TOKEN
```

## Token Management

### Refresh Token Flow
The auth server implements a secure token rotation mechanism:

1. **Login** returns both access token (15min) and refresh token (7 days)
2. **Access token expires** → Use refresh token to get new tokens
3. **Old refresh token is revoked** → New tokens are issued
4. **Automatic handling** → See examples in `auth-server/examples/`

```bash
# Refresh tokens when access token expires
POST /api/auth/refresh
{
  "refreshToken": "your_refresh_token"
}
```

### Token Refresh Demo
```bash
cd auth-server/examples
npm install
npm run demo
```

This demonstrates:
- Automatic token refresh on 401 errors
- Token expiration handling
- Secure token storage patterns

## Security

- Passwords are hashed with bcrypt
- JWT tokens expire in 15 minutes (configurable)
- Refresh tokens expire in 7 days
- Token rotation on each refresh (old tokens revoked)
- Rate limiting on authentication endpoints
- Audit logging for all auth events
- Request limits based on license type
- Automatic daily request count reset

## Development

### Running locally
1. Start PostgreSQL
2. Run auth server: `cd auth-server && npm run dev`
3. Run proxy server: `npm run dev`

### Testing
- Health check auth: `http://localhost:3001/health`
- Health check proxy: `http://localhost:3000/health`

## Troubleshooting

### Auth server connection issues
The proxy server will fall back to local JWT validation if the auth server is unavailable, but without user status or rate limit checks.

### Token expiration
Use the refresh token endpoint to get new access tokens:
```bash
POST /api/auth/refresh
{
  "refreshToken": "YOUR_REFRESH_TOKEN"
}
```

### Rate limits
If you exceed your daily request limit, you'll receive a 429 error. Limits reset daily at midnight.