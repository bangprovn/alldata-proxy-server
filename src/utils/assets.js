import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { authManager } from '../middleware/auth.js';
import { config } from '../config/index.js';

const STATIC_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'pdf', 'html', 'css', 'js', 'woff', 'woff2', 'ttf', 'eot', 'otf', 'ico'];
const FONT_EXTENSIONS = ['woff', 'woff2', 'ttf', 'eot', 'otf'];

const CONTENT_TYPES = {
  'png': 'image/png',
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'gif': 'image/gif',
  'svg': 'image/svg+xml',
  'pdf': 'application/pdf',
  'html': 'text/html',
  'css': 'text/css',
  'js': 'application/javascript',
  'woff': 'font/woff',
  'woff2': 'font/woff2',
  'ttf': 'font/ttf',
  'eot': 'application/vnd.ms-fontobject',
  'otf': 'font/otf',
  'ico': 'image/x-icon'
};

export function isStaticAsset(path) {
  // Check if path ends with a file extension
  if (/\.[a-zA-Z0-9]+$/.test(path)) {
    return true;
  }
  
  // Check for underscore pattern with common asset extensions
  const underscorePattern = new RegExp(`_(${STATIC_EXTENSIONS.join('|')})$`, 'i');
  return underscorePattern.test(path);
}

export function isFontFile(path) {
  return /\.(woff|woff2|ttf|eot|otf)(\?.*)?$/i.test(path) || path.includes('/fonts/');
}

export function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase().substring(1);
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

export async function downloadAsset(url, filePath) {
  const dir = path.dirname(filePath);
  
  if (!fs.existsSync(dir)) {
    await fs.promises.mkdir(dir, { recursive: true });
  }

  const accessToken = await authManager.getValidToken();
  
  const response = await axios({
    method: 'GET',
    url: `${config.proxy.target}${url}`,
    headers: {
      'Cookie': `accessToken=${accessToken}`,
      'Accept': '*/*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    responseType: 'stream',
    timeout: config.proxy.timeout
  });

  if (response.status !== 200) {
    throw new Error(`Failed to download asset: ${response.status}`);
  }

  const writer = fs.createWriteStream(filePath);
  response.data.pipe(writer);
  
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

export function normalizeAssetPath(requestPath) {
  const pathWithoutQuery = requestPath.split('?')[0];
  
  // Handle underscore pattern files
  const underscoreMatch = pathWithoutQuery.match(/_([a-zA-Z0-9]+)$/);
  if (underscoreMatch) {
    return pathWithoutQuery.replace(/_([a-zA-Z0-9]+)$/, '.$1');
  }
  
  return pathWithoutQuery;
}