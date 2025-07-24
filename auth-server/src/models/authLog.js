import db from '../db/database.js';

class AuthLog {
  static async log({ userId, action, ipAddress, userAgent, success = true, errorMessage = null, metadata = {} }) {
    const query = `
      INSERT INTO auth_logs (user_id, action, ip_address, user_agent, success, error_message, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, created_at
    `;
    
    const result = await db.query(query, [
      userId,
      action,
      ipAddress,
      userAgent,
      success,
      errorMessage,
      metadata
    ]);
    
    return result.rows[0];
  }
  
  static async getUserLogs(userId, limit = 50) {
    const query = `
      SELECT id, action, ip_address, user_agent, success, error_message, metadata, created_at
      FROM auth_logs
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;
    
    const result = await db.query(query, [userId, limit]);
    return result.rows;
  }
  
  static async getFailedAttempts(ipAddress, minutes = 15) {
    const query = `
      SELECT COUNT(*) as count
      FROM auth_logs
      WHERE ip_address = $1
        AND success = false
        AND action IN ('login', 'register')
        AND created_at > NOW() - INTERVAL '${minutes} minutes'
    `;
    
    const result = await db.query(query, [ipAddress]);
    return parseInt(result.rows[0].count);
  }
  
  static async getRecentActivity(minutes = 60, limit = 100) {
    const query = `
      SELECT 
        al.*, 
        u.email, 
        u.username
      FROM auth_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.created_at > NOW() - INTERVAL '${minutes} minutes'
      ORDER BY al.created_at DESC
      LIMIT $1
    `;
    
    const result = await db.query(query, [limit]);
    return result.rows;
  }
}

export default AuthLog;