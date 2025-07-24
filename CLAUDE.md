# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Start server**: `npm start` - Runs the refactored server at src/server.js
- **Development mode**: `npm run dev` - Uses nodemon for auto-reload
- **Linting**: `npm run lint` - Runs ESLint on all src/**/*.js files
- **Docker**: `docker-compose up -d` to run in container with persistent volumes

## Architecture Overview

This is a proxy server for AllDATA EU API with authentication, caching, and asset handling.

### Core Services:
- **Authentication**: Token-based auth with refresh mechanism (src/authManager.js)
- **Caching**: SQLite-indexed hierarchical cache system (src/cacheManager.js) 
- **Proxy**: HTTP proxy middleware for API requests (src/services/proxy.js)
- **Static Assets**: Downloads and serves HTML/CSS/JS/images locally

### Key Features:
- Modular ES6 architecture with imports
- Winston logging with different levels
- Helmet security headers
- Compression middleware
- Morgan request logging
- CORS support

## Cache System

The cache system uses:
- SQLite database (cache-index.db) for fast lookups with indexed queries
- Hierarchical file structure in cache/data/ organized by URL paths
- Hash-based directory sharding for performance
- Tracks access counts and provides detailed statistics

Cache endpoints:
- GET /api/cache/stats - Comprehensive statistics
- POST /api/cache/cleanup - Intelligent cleanup with configurable criteria
- POST /api/cache/revalidate - Path-based cache invalidation

## Environment Configuration

Required .env variables:
- ALLDATA_EMAIL - AllData account email
- ALLDATA_PASSWORD - AllData account password  
- PORT - Server port (default: 3000)
- CACHE_TTL - Cache time-to-live in seconds
- LOG_LEVEL - Logging level (error, warn, info, debug)

## API Structure

- /api/auth/* - Authentication endpoints (login, refresh, test-token)
- /api/cache/* - Cache management endpoints
- /api/health - Health check endpoint
- /* - Proxied requests to AllData API

## Important Implementation Details

- All API routes require authentication via Authorization header
- Static assets are automatically downloaded and served locally
- Cache uses normalized URLs and stores metadata in SQLite
- Streaming responses for large files to reduce memory usage
- Non-root Docker user (nodejs) for security
- Persistent Docker volumes for cache/ and public/app-alldata/alldata/