import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const config = {
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    env: process.env.NODE_ENV || 'development'
  },
  auth: {
    email: process.env.ALLDATA_EMAIL,
    password: process.env.ALLDATA_PASSWORD
  },
  proxy: {
    target: 'https://data-eu.partnership.workshopdiag.com',
    timeout: 30000,
    maxRedirects: 5
  },
  cache: {
    ttl: parseInt(process.env.CACHE_TTL || '3600', 10), // 1 hour default
    maxSize: parseInt(process.env.CACHE_MAX_SIZE || '100', 10) // MB
  },
  paths: {
    public: path.join(__dirname, '..', '..', 'public'),
    cache: path.join(__dirname, '..', '..', 'cache')
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info'
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'your_jwt_secret_key_change_this',
    issuer: process.env.JWT_ISSUER || 'alldata-auth-server'
  },
  authServer: {
    url: process.env.AUTH_SERVER_URL || 'http://localhost:3001'
  }
};

// Validate required configuration
export function validateConfig() {
  const errors = [];

  if (!config.auth.email) {
    errors.push('ALLDATA_EMAIL is required');
  }

  if (!config.auth.password) {
    errors.push('ALLDATA_PASSWORD is required');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration errors: ${errors.join(', ')}`);
  }

  return true;
}