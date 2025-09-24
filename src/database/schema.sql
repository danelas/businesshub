-- LLC Lead Generation Database Schema

-- Create database (run this separately)
-- CREATE DATABASE llc_leads;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Leads table - stores LLC information
CREATE TABLE leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_name VARCHAR(255) NOT NULL,
    state VARCHAR(2) NOT NULL,
    business_type VARCHAR(100),
    registration_date DATE,
    status VARCHAR(50) DEFAULT 'active',
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    city VARCHAR(100),
    zip_code VARCHAR(20),
    phone VARCHAR(20),
    email VARCHAR(255),
    website VARCHAR(255),
    ein VARCHAR(20),
    registered_agent VARCHAR(255),
    
    -- Segmentation fields
    industry VARCHAR(100),
    employee_count_estimate INTEGER,
    revenue_estimate DECIMAL(15,2),
    
    -- Tracking fields
    source VARCHAR(100), -- 'state_registry', 'csv_import', 'api_import'
    source_file VARCHAR(255),
    import_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Deduplication hash
    dedup_hash VARCHAR(64) UNIQUE,
    
    CONSTRAINT leads_state_check CHECK (LENGTH(state) = 2),
    CONSTRAINT leads_status_check CHECK (status IN ('active', 'inactive', 'duplicate', 'opted_out', 'invalid'))
);

-- Messages table - tracks all outreach attempts
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    message_type VARCHAR(20) NOT NULL, -- 'sms', 'email'
    template_name VARCHAR(100) NOT NULL,
    recipient_phone VARCHAR(20),
    recipient_email VARCHAR(255),
    subject VARCHAR(255), -- for emails
    content TEXT NOT NULL,
    
    -- Personalization data
    personalized_data JSONB,
    affiliate_links JSONB,
    
    -- Delivery tracking
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'sent', 'delivered', 'failed', 'bounced', 'opted_out'
    sent_at TIMESTAMP,
    delivered_at TIMESTAMP,
    failed_at TIMESTAMP,
    failure_reason TEXT,
    
    -- Provider tracking
    provider_message_id VARCHAR(255),
    provider_status VARCHAR(100),
    provider_response JSONB,
    
    -- Campaign tracking
    campaign_id VARCHAR(100),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT messages_type_check CHECK (message_type IN ('sms', 'email')),
    CONSTRAINT messages_status_check CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'bounced', 'opted_out'))
);

-- Message templates
CREATE TABLE message_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) UNIQUE NOT NULL,
    type VARCHAR(20) NOT NULL, -- 'sms', 'email'
    subject VARCHAR(255), -- for emails
    content TEXT NOT NULL,
    variables JSONB, -- list of available variables
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT templates_type_check CHECK (type IN ('sms', 'email'))
);

-- Opt-outs table
CREATE TABLE opt_outs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone VARCHAR(20),
    email VARCHAR(255),
    lead_id UUID REFERENCES leads(id),
    opt_out_type VARCHAR(20) NOT NULL, -- 'sms', 'email', 'all'
    opted_out_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    source VARCHAR(100), -- 'reply', 'web_form', 'manual'
    
    CONSTRAINT opt_outs_type_check CHECK (opt_out_type IN ('sms', 'email', 'all')),
    CONSTRAINT opt_outs_contact_check CHECK (phone IS NOT NULL OR email IS NOT NULL)
);

-- Campaign tracking
CREATE TABLE campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    message_type VARCHAR(20) NOT NULL,
    template_id UUID REFERENCES message_templates(id),
    
    -- Targeting criteria
    target_states TEXT[], -- array of state codes
    target_business_types TEXT[],
    target_industries TEXT[],
    min_registration_date DATE,
    max_registration_date DATE,
    
    -- Campaign settings
    daily_limit INTEGER DEFAULT 100,
    hourly_limit INTEGER DEFAULT 10,
    start_date DATE,
    end_date DATE,
    is_active BOOLEAN DEFAULT true,
    
    -- Statistics
    total_targeted INTEGER DEFAULT 0,
    total_sent INTEGER DEFAULT 0,
    total_delivered INTEGER DEFAULT 0,
    total_failed INTEGER DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT campaigns_type_check CHECK (message_type IN ('sms', 'email'))
);

-- Data import logs
CREATE TABLE import_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    filename VARCHAR(255),
    source VARCHAR(100) NOT NULL,
    total_records INTEGER,
    processed_records INTEGER,
    new_records INTEGER,
    duplicate_records INTEGER,
    error_records INTEGER,
    status VARCHAR(50) DEFAULT 'processing',
    error_details JSONB,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    
    CONSTRAINT import_status_check CHECK (status IN ('processing', 'completed', 'failed'))
);

-- System settings
CREATE TABLE system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_leads_state ON leads(state);
CREATE INDEX idx_leads_business_type ON leads(business_type);
CREATE INDEX idx_leads_registration_date ON leads(registration_date);
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_dedup_hash ON leads(dedup_hash);
CREATE INDEX idx_leads_import_date ON leads(import_date);

CREATE INDEX idx_messages_lead_id ON messages(lead_id);
CREATE INDEX idx_messages_type ON messages(message_type);
CREATE INDEX idx_messages_status ON messages(status);
CREATE INDEX idx_messages_sent_at ON messages(sent_at);
CREATE INDEX idx_messages_campaign_id ON messages(campaign_id);

CREATE INDEX idx_opt_outs_phone ON opt_outs(phone);
CREATE INDEX idx_opt_outs_email ON opt_outs(email);
CREATE INDEX idx_opt_outs_type ON opt_outs(opt_out_type);

-- Triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_leads_updated_at BEFORE UPDATE ON leads
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_messages_updated_at BEFORE UPDATE ON messages
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_templates_updated_at BEFORE UPDATE ON message_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON campaigns
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default message templates
INSERT INTO message_templates (name, type, subject, content, variables) VALUES
('llc_welcome_sms', 'sms', NULL, 
'Hi {{company_name}}! Congrats on your new LLC! Need help with EIN, banking, or accounting? Check out our resources: {{affiliate_link}} Reply STOP to opt out.',
'["company_name", "affiliate_link"]'),

('llc_welcome_email', 'email', 'Welcome {{company_name}} - Essential LLC Resources Inside',
'Subject: Welcome {{company_name}} - Essential LLC Resources Inside

Hi there,

Congratulations on registering {{company_name}} as an LLC! 

Starting a business is exciting, and we want to help you get set up for success. Here are some essential next steps:

🏦 Get your EIN (Tax ID): {{ein_link}}
💳 Open a business bank account: {{banking_link}}  
📊 Set up accounting & bookkeeping: {{accounting_link}}
🛡️ Protect your business with insurance: {{insurance_link}}

These affiliate partners offer special rates for new LLCs like yours.

Questions? Just reply to this email.

Best regards,
The Business Success Team

---
To unsubscribe: {{unsubscribe_link}}',
'["company_name", "ein_link", "banking_link", "accounting_link", "insurance_link", "unsubscribe_link"]');

-- Insert default system settings
INSERT INTO system_settings (key, value, description) VALUES
('daily_message_limit', '1000', 'Maximum messages to send per day'),
('hourly_message_limit', '100', 'Maximum messages to send per hour'),
('dedup_window_days', '30', 'Days to look back for duplicate detection'),
('auto_campaign_enabled', 'true', 'Enable automatic campaign processing'),
('message_delay_seconds', '5', 'Delay between individual messages');
