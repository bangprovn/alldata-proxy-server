import db from '../db/database.js';

class RefreshToken {
  static async create({ userId, token, expiresAt, deviceInfo = {} }) {
    const query = `
      INSERT INTO refresh_tokens (user_id, token, expires_at, device_info)
      VALUES ($1, $2, $3, $4)
      RETURNING id, user_id, token, expires_at, created_at
    `;
    
    const result = await db.query(query, [userId, token, expiresAt, deviceInfo]);
    return result.rows[0];
  }
  
  static async findByToken(token) {
    const query = `
      SELECT id, user_id, token, expires_at, created_at, is_revoked, device_info
      FROM refresh_tokens
      WHERE token = $1 AND is_revoked = false
    `;
    
    const result = await db.query(query, [token]);
    return result.rows[0];
  }
  
  static async revoke(token) {
    const query = `
      UPDATE refresh_tokens
      SET is_revoked = true
      WHERE token = $1
      RETURNING id, user_id, token, is_revoked
    `;
    
    const result = await db.query(query, [token]);
    return result.rows[0];
  }
  
  static async revokeAllForUser(userId) {
    const query = `
      UPDATE refresh_tokens
      SET is_revoked = true
      WHERE user_id = $1 AND is_revoked = false
      RETURNING id
    `;
    
    const result = await db.query(query, [userId]);
    return result.rows;
  }
  
  static async deleteExpired() {
    const query = `
      DELETE FROM refresh_tokens
      WHERE expires_at < CURRENT_TIMESTAMP
      RETURNING id
    `;
    
    const result = await db.query(query);
    return result.rows;
  }
  
  static async isValid(token) {
    const refreshToken = await this.findByToken(token);
    
    if (!refreshToken) {
      return false;
    }
    
    if (refreshToken.is_revoked) {
      return false;
    }
    
    if (new Date(refreshToken.expires_at) < new Date()) {
      return false;
    }
    
    return true;
  }
  
  static async getUserActiveTokens(userId) {
    const query = `
      SELECT id, token, expires_at, created_at, device_info
      FROM refresh_tokens
      WHERE user_id = $1 AND is_revoked = false AND expires_at > CURRENT_TIMESTAMP
      ORDER BY created_at DESC
    `;
    
    const result = await db.query(query, [userId]);
    return result.rows;
  }
}

export default RefreshToken;