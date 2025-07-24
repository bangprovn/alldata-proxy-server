import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { config, validateConfig } from './config/index.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import logger from './utils/logger.js';

// Validate configuration
try {
  validateConfig();
} catch (error) {
  logger.error('Configuration validation failed:', error);
  process.exit(1);
}

const app = express();

// Security middleware
app.use(helmet());

// CORS
app.use(cors({
  origin: true,
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: 'Too many requests from this IP, please try again later.'
});

app.use('/api/', limiter);

// Request logging
app.use(morgan('combined', {
  stream: { write: message => logger.info(message.trim()) }
}));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'auth-server',
    timestamp: new Date().toISOString()
  });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', {
    error: err.message,
    stack: err.stack,
    url: req.originalUrl
  });
  
  res.status(500).json({ 
    error: 'Internal server error',
    message: config.server.env === 'development' ? err.message : undefined
  });
});

// Start server
const server = app.listen(config.server.port, () => {
  logger.info(`Auth server running on http://localhost:${config.server.port}`);
  logger.info(`Environment: ${config.server.env}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

export default app;