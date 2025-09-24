-- Additional tables for Florida LLC data and contact enrichment

-- Table to store officer information for LLCs
CREATE TABLE IF NOT EXISTS lead_officers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    title VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table to log contact enrichment attempts
CREATE TABLE IF NOT EXISTS contact_enrichment_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    phones_found INTEGER DEFAULT 0,
    emails_found INTEGER DEFAULT 0,
    website_found BOOLEAN DEFAULT false,
    sources JSONB, -- Array of sources used (google, yelp, etc.)
    enrichment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    success BOOLEAN DEFAULT false,
    error_message TEXT,
    processing_time_ms INTEGER
);

-- Table to track Florida SFTP file downloads
CREATE TABLE IF NOT EXISTS florida_file_downloads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    filename VARCHAR(255) NOT NULL,
    file_size BIGINT,
    download_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_date TIMESTAMP,
    records_found INTEGER,
    records_imported INTEGER,
    status VARCHAR(50) DEFAULT 'downloaded', -- 'downloaded', 'processed', 'failed'
    error_details JSONB
);

-- Table to store raw Florida LLC data for reference
CREATE TABLE IF NOT EXISTS florida_raw_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
    filename VARCHAR(255),
    raw_json JSONB NOT NULL,
    processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_lead_officers_lead_id ON lead_officers(lead_id);
CREATE INDEX IF NOT EXISTS idx_contact_enrichment_lead_id ON contact_enrichment_log(lead_id);
CREATE INDEX IF NOT EXISTS idx_contact_enrichment_date ON contact_enrichment_log(enrichment_date);
CREATE INDEX IF NOT EXISTS idx_contact_enrichment_success ON contact_enrichment_log(success);
CREATE INDEX IF NOT EXISTS idx_florida_downloads_filename ON florida_file_downloads(filename);
CREATE INDEX IF NOT EXISTS idx_florida_downloads_date ON florida_file_downloads(download_date);
CREATE INDEX IF NOT EXISTS idx_florida_raw_lead_id ON florida_raw_data(lead_id);

-- Add Florida-specific columns to leads table if they don't exist
DO $$ 
BEGIN
    -- Add officers column to store officer information as JSON
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'leads' AND column_name = 'officers') THEN
        ALTER TABLE leads ADD COLUMN officers JSONB;
    END IF;
    
    -- Add enrichment status tracking
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'leads' AND column_name = 'enrichment_status') THEN
        ALTER TABLE leads ADD COLUMN enrichment_status VARCHAR(50) DEFAULT 'pending';
    END IF;
    
    -- Add last enrichment attempt date
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'leads' AND column_name = 'last_enrichment_attempt') THEN
        ALTER TABLE leads ADD COLUMN last_enrichment_attempt TIMESTAMP;
    END IF;
    
    -- Add contact source tracking
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'leads' AND column_name = 'contact_sources') THEN
        ALTER TABLE leads ADD COLUMN contact_sources JSONB;
    END IF;
END $$;

-- Create indexes for new columns
CREATE INDEX IF NOT EXISTS idx_leads_enrichment_status ON leads(enrichment_status);
CREATE INDEX IF NOT EXISTS idx_leads_last_enrichment ON leads(last_enrichment_attempt);

-- Function to update enrichment status
CREATE OR REPLACE FUNCTION update_lead_enrichment_status()
RETURNS TRIGGER AS $$
BEGIN
    -- Update enrichment status based on available contact info
    IF NEW.phone IS NOT NULL OR NEW.email IS NOT NULL THEN
        NEW.enrichment_status = 'completed';
    ELSE
        NEW.enrichment_status = 'pending';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update enrichment status
DROP TRIGGER IF EXISTS trigger_update_enrichment_status ON leads;
CREATE TRIGGER trigger_update_enrichment_status
    BEFORE UPDATE ON leads
    FOR EACH ROW
    EXECUTE FUNCTION update_lead_enrichment_status();

-- View for Florida LLC statistics
CREATE OR REPLACE VIEW florida_llc_stats AS
SELECT 
    DATE_TRUNC('day', registration_date) as registration_day,
    COUNT(*) as total_registered,
    COUNT(CASE WHEN phone IS NOT NULL THEN 1 END) as with_phone,
    COUNT(CASE WHEN email IS NOT NULL THEN 1 END) as with_email,
    COUNT(CASE WHEN phone IS NOT NULL AND email IS NOT NULL THEN 1 END) as with_both,
    COUNT(CASE WHEN enrichment_status = 'completed' THEN 1 END) as enriched,
    ROUND(
        COUNT(CASE WHEN phone IS NOT NULL OR email IS NOT NULL THEN 1 END) * 100.0 / COUNT(*), 
        2
    ) as contact_rate
FROM leads 
WHERE state = 'FL' 
    AND registration_date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', registration_date)
ORDER BY registration_day DESC;

-- View for enrichment performance
CREATE OR REPLACE VIEW enrichment_performance AS
SELECT 
    DATE_TRUNC('day', enrichment_date) as enrichment_day,
    COUNT(*) as total_attempts,
    COUNT(CASE WHEN success = true THEN 1 END) as successful,
    AVG(phones_found) as avg_phones_found,
    AVG(emails_found) as avg_emails_found,
    COUNT(CASE WHEN website_found = true THEN 1 END) as websites_found,
    ROUND(
        COUNT(CASE WHEN success = true THEN 1 END) * 100.0 / COUNT(*), 
        2
    ) as success_rate,
    AVG(processing_time_ms) as avg_processing_time_ms
FROM contact_enrichment_log 
WHERE enrichment_date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', enrichment_date)
ORDER BY enrichment_day DESC;
