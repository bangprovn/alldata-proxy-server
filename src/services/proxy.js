import axios from 'axios';
import { PassThrough } from 'stream';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

class ProxyService {
  constructor() {
    this.client = axios.create({
      baseURL: config.proxy.target,
      timeout: config.proxy.timeout,
      maxRedirects: config.proxy.maxRedirects,
      validateStatus: () => true, // Don't throw on any status
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    // Add request interceptor for logging
    this.client.interceptors.request.use(
      (request) => {
        logger.debug('Proxy request:', {
          method: request.method,
          url: request.url,
          headers: request.headers
        });
        return request;
      },
      (error) => {
        logger.error('Proxy request error:', error);
        return Promise.reject(error);
      }
    );

    // Add response interceptor for logging
    this.client.interceptors.response.use(
      (response) => {
        logger.debug('Proxy response:', {
          status: response.status,
          url: response.config.url,
          headers: response.headers
        });
        return response;
      },
      (error) => {
        logger.error('Proxy response error:', error);
        return Promise.reject(error);
      }
    );
  }

  buildHeaders(req, accessToken, isApiRequest = false) {
    const headers = {
      ...req.headers,
      'cookie': `accessToken=${accessToken}`,
      'origin': config.proxy.target,
      'referer': `${config.proxy.target}/`,
      'accessToken': accessToken
    };

    // Preserve web-from header if present
    if (req.headers['web-from']) {
      headers['web-from'] = req.headers['web-from'];
    }

    // For API requests, also send access token in Authorization header
    if (isApiRequest) {
      headers['Accesstoken'] = accessToken;
      headers['Content-Type'] = 'application/json';
    }

    // Remove headers that might cause issues
    delete headers['host'];
    delete headers['connection'];
    delete headers['content-length'];

    return headers;
  }

  async makeRequest(options) {
    try {
      const response = await this.client(options);
      return response;
    } catch (error) {
      logger.error('Proxy request failed:', {
        error: error.message,
        url: options.url,
        method: options.method
      });
      throw error;
    }
  }

  createDuplicateStream(sourceStream) {
    const passThrough1 = new PassThrough();
    const passThrough2 = new PassThrough();

    sourceStream.on('data', (chunk) => {
      passThrough1.write(chunk);
      passThrough2.write(chunk);
    });

    sourceStream.on('end', () => {
      passThrough1.end();
      passThrough2.end();
    });

    sourceStream.on('error', (error) => {
      passThrough1.destroy(error);
      passThrough2.destroy(error);
    });

    return { stream1: passThrough1, stream2: passThrough2 };
  }

  isApiRequest(req) {
    return req.headers['content-type']?.includes('application/json') ||
           req.headers['accept']?.includes('application/json') ||
           req.originalUrl.includes('/api/') ||
           req.originalUrl.includes('/alldata/');
  }
}

export default new ProxyService();