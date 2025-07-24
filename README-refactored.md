# AllData Proxy Server - Refactored Version

This is a refactored version of the AllData proxy server with improved architecture, performance, and maintainability.

## Features

- **Modular Architecture**: Clean separation of concerns with dedicated modules for routes, middleware, services, and utilities
- **Enhanced Caching**: Improved cache management with better performance and TTL support
- **Better Error Handling**: Comprehensive error handling with Winston logging
- **Security**: Added Helmet for security headers and compression for better performance
- **Configuration Management**: Centralized configuration with validation
- **Type Safety**: Better structure for future TypeScript migration

## Installation

```bash
npm install
```

## Configuration

1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Update the environment variables with your credentials:
- `ALLDATA_EMAIL`: Your AllData email
- `ALLDATA_PASSWORD`: Your AllData password
- `PORT`: Server port (default: 3000)
- `CACHE_TTL`: Cache time-to-live in seconds
- `LOG_LEVEL`: Logging level (error, warn, info, debug)

## Usage

### Start the refactored server:
```bash
npm start
```

### Development mode with auto-reload:
```bash
npm run dev
```

### Use the old server implementations:
```bash
npm run start:old  # Original server.js
npm run start:axios  # Original server-axios.js
```

## Project Structure

```
src/
├── config/           # Configuration management
│   └── index.js
├── middleware/       # Express middleware
│   ├── auth.js      # Authentication middleware
│   └── cache.js     # Cache middleware
├── routes/          # API route handlers
│   ├── auth.js      # Authentication routes
│   └── cache.js     # Cache management routes
├── services/        # Business logic services
│   └── proxy.js     # Proxy service
├── utils/           # Utility functions
│   ├── assets.js    # Asset handling utilities
│   └── logger.js    # Winston logger configuration
└── server-refactored.js  # Main server file
```

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login with email/password
- `POST /api/auth/refresh` - Refresh access token
- `GET /api/auth/test-token` - Test token validity

### Cache Management
- `GET /api/cache/stats` - Get cache statistics
- `POST /api/cache/revalidate` - Revalidate specific path
- `DELETE /api/cache` - Clear all cache
- `GET /api/cache/entry` - Get specific cache entry info

### Health Check
- `GET /api/health` - Server health status

## Improvements

### Performance
- Streaming responses for large files
- Efficient cache key generation
- Compression middleware for smaller payloads
- Static asset caching with proper headers

### Security
- Helmet middleware for security headers
- Proper CORS configuration
- Input validation
- Secure error messages in production

### Maintainability
- Modular code structure
- Centralized configuration
- Comprehensive logging
- Clear separation of concerns

### Monitoring
- Winston logging with different levels
- Request/response logging
- Error tracking
- Cache hit/miss metrics

## Migration from Old Server

To migrate from the old server implementation:

1. The refactored server is backward compatible with existing clients
2. All existing endpoints work the same way
3. Cache format is compatible
4. Environment variables remain the same

## Future Enhancements

- Add unit and integration tests
- Implement rate limiting
- Add metrics collection (Prometheus)
- TypeScript migration
- Docker support
- API documentation with Swagger