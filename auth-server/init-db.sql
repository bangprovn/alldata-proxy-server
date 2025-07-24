-- Create users table with license support
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    license_type VARCHAR(50) NOT NULL DEFAULT 'basic',
    license_expiry TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMP WITH TIME ZONE,
    
    -- Additional user metadata
    full_name VARCHAR(255),
    company VARCHAR(255),
    api_key VARCHAR(255) UNIQUE,
    max_requests_per_day INTEGER DEFAULT 1000,
    current_requests_today INTEGER DEFAULT 0,
    last_request_reset TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create refresh tokens table
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(500) UNIQUE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_revoked BOOLEAN DEFAULT false,
    device_info JSONB
);

-- Create audit log table
CREATE TABLE IF NOT EXISTS auth_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,
    ip_address INET,
    user_agent TEXT,
    success BOOLEAN DEFAULT true,
    error_message TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create license types table
CREATE TABLE IF NOT EXISTS license_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    max_requests_per_day INTEGER NOT NULL,
    features JSONB,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert default license types
INSERT INTO license_types (name, display_name, max_requests_per_day, features) VALUES
    ('basic', 'Basic Plan', 1000, '{"api_access": true, "cache_access": false, "priority_support": false}'),
    ('professional', 'Professional Plan', 10000, '{"api_access": true, "cache_access": true, "priority_support": false}'),
    ('enterprise', 'Enterprise Plan', 100000, '{"api_access": true, "cache_access": true, "priority_support": true, "custom_limits": true}')
ON CONFLICT (name) DO NOTHING;

-- Create indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_api_key ON users(api_key);
CREATE INDEX idx_users_license_type ON users(license_type);
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token ON refresh_tokens(token);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
CREATE INDEX idx_auth_logs_user_id ON auth_logs(user_id);
CREATE INDEX idx_auth_logs_created_at ON auth_logs(created_at);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for users table
CREATE TRIGGER update_users_updated_at BEFORE UPDATE
    ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create function to reset daily request counts
CREATE OR REPLACE FUNCTION reset_daily_requests()
RETURNS void AS $$
BEGIN
    UPDATE users 
    SET current_requests_today = 0, 
        last_request_reset = CURRENT_TIMESTAMP
    WHERE last_request_reset < CURRENT_DATE;
END;
$$ LANGUAGE plpgsql;