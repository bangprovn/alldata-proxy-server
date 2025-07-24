import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const config = {
  server: {
    port: parseInt(process.env.PORT || '3001', 10),
    env: process.env.NODE_ENV || 'development',
  },
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    name: process.env.DB_NAME || 'alldata_auth',
    user: process.env.DB_USER || 'auth_user',
    password: process.env.DB_PASSWORD || 'auth_secret_password',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'your_jwt_secret_key_change_this',
    accessTokenExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
    refreshTokenExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
    issuer: process.env.JWT_ISSUER || 'alldata-auth-server',
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '15', 10) * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
};

export function validateConfig() {
  const errors = [];
  
  if (!config.jwt.secret || config.jwt.secret === 'your_jwt_secret_key_change_this') {
    errors.push('JWT_SECRET must be set to a secure value');
  }
  
  if (!config.db.password || config.db.password === 'auth_secret_password') {
    errors.push('DB_PASSWORD must be set to a secure value');
  }
  
  if (errors.length > 0) {
    throw new Error(`Configuration errors: ${errors.join(', ')}`);
  }
  
  return true;
}