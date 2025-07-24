import bcrypt from 'bcrypt';
import db from '../db/database.js';
import { generateApiKey } from '../utils/jwt.js';

const SALT_ROUNDS = 10;

class User {
  static async create({ email, username, password, licenseType = 'basic', company = null, fullName = null }) {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    
    return db.transaction(async (client) => {
      // Get license type details
      const licenseQuery = `
        SELECT max_requests_per_day, features
        FROM license_types
        WHERE name = $1 AND is_active = true
      `;
      const licenseResult = await client.query(licenseQuery, [licenseType]);
      
      if (licenseResult.rows.length === 0) {
        throw new Error('Invalid license type');
      }
      
      const license = licenseResult.rows[0];
      
      // Create user
      const userQuery = `
        INSERT INTO users (
          email, username, password_hash, license_type, 
          max_requests_per_day, company, full_name
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, email, username, license_type, created_at, is_active, max_requests_per_day
      `;
      
      const userResult = await client.query(userQuery, [
        email, username, passwordHash, licenseType, 
        license.max_requests_per_day, company, fullName
      ]);
      
      const user = userResult.rows[0];
      
      // Generate and save API key
      const apiKey = generateApiKey(user);
      await client.query(
        'UPDATE users SET api_key = $1 WHERE id = $2',
        [apiKey, user.id]
      );
      
      return { ...user, api_key: apiKey };
    });
  }
  
  static async findById(id) {
    const query = `
      SELECT id, email, username, license_type, license_expiry,
             created_at, updated_at, is_active, last_login,
             full_name, company, max_requests_per_day, current_requests_today
      FROM users
      WHERE id = $1
    `;
    
    const result = await db.query(query, [id]);
    return result.rows[0];
  }
  
  static async findByEmail(email) {
    const query = `
      SELECT id, email, username, password_hash, license_type, license_expiry,
             created_at, updated_at, is_active, last_login,
             full_name, company, api_key, max_requests_per_day, current_requests_today
      FROM users
      WHERE email = $1
    `;
    
    const result = await db.query(query, [email]);
    return result.rows[0];
  }
  
  static async findByUsername(username) {
    const query = `
      SELECT id, email, username, password_hash, license_type, license_expiry,
             created_at, updated_at, is_active, last_login,
             full_name, company, api_key, max_requests_per_day, current_requests_today
      FROM users
      WHERE username = $1
    `;
    
    const result = await db.query(query, [username]);
    return result.rows[0];
  }
  
  static async findByApiKey(apiKey) {
    const query = `
      SELECT id, email, username, license_type, license_expiry,
             is_active, max_requests_per_day, current_requests_today
      FROM users
      WHERE api_key = $1
    `;
    
    const result = await db.query(query, [apiKey]);
    return result.rows[0];
  }
  
  static async verifyPassword(plainPassword, passwordHash) {
    return bcrypt.compare(plainPassword, passwordHash);
  }
  
  static async updateLastLogin(id) {
    const query = `
      UPDATE users
      SET last_login = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, email, username, last_login
    `;
    
    const result = await db.query(query, [id]);
    return result.rows[0];
  }
  
  static async incrementRequestCount(id) {
    const query = `
      UPDATE users
      SET current_requests_today = current_requests_today + 1
      WHERE id = $1
      RETURNING current_requests_today, max_requests_per_day
    `;
    
    const result = await db.query(query, [id]);
    return result.rows[0];
  }
  
  static async checkRequestLimit(id) {
    const query = `
      SELECT current_requests_today, max_requests_per_day, last_request_reset
      FROM users
      WHERE id = $1
    `;
    
    const result = await db.query(query, [id]);
    const user = result.rows[0];
    
    if (!user) return false;
    
    // Check if we need to reset the counter
    const lastReset = new Date(user.last_request_reset);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (lastReset < today) {
      await db.query(
        'UPDATE users SET current_requests_today = 0, last_request_reset = CURRENT_TIMESTAMP WHERE id = $1',
        [id]
      );
      return true;
    }
    
    return user.current_requests_today < user.max_requests_per_day;
  }
  
  static async updateLicense(id, licenseType, expiryDate = null) {
    return db.transaction(async (client) => {
      // Get new license details
      const licenseQuery = `
        SELECT max_requests_per_day, features
        FROM license_types
        WHERE name = $1 AND is_active = true
      `;
      const licenseResult = await client.query(licenseQuery, [licenseType]);
      
      if (licenseResult.rows.length === 0) {
        throw new Error('Invalid license type');
      }
      
      const license = licenseResult.rows[0];
      
      // Update user
      const updateQuery = `
        UPDATE users
        SET license_type = $1,
            license_expiry = $2,
            max_requests_per_day = $3
        WHERE id = $4
        RETURNING id, email, username, license_type, license_expiry
      `;
      
      const result = await client.query(updateQuery, [
        licenseType, expiryDate, license.max_requests_per_day, id
      ]);
      
      return result.rows[0];
    });
  }
  
  static async regenerateApiKey(id) {
    const user = await this.findById(id);
    if (!user) throw new Error('User not found');
    
    const newApiKey = generateApiKey(user);
    
    const query = `
      UPDATE users
      SET api_key = $1
      WHERE id = $2
      RETURNING api_key
    `;
    
    const result = await db.query(query, [newApiKey, id]);
    return result.rows[0].api_key;
  }
}

export default User;