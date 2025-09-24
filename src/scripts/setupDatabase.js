require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { query, closePool, logger } = require('../database/connection');

async function setupDatabase() {
  try {
    logger.info('Setting up database...');

    // Step 1: Create main tables
    const mainSchema = `
      -- Enable UUID extension
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

      -- Leads table
      CREATE TABLE IF NOT EXISTS leads (
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
          source VARCHAR(100),
          source_file VARCHAR(255),
          import_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          
          -- Deduplication hash
          dedup_hash VARCHAR(64) UNIQUE,
          
          CONSTRAINT leads_state_check CHECK (LENGTH(state) = 2),
          CONSTRAINT leads_status_check CHECK (status IN ('active', 'inactive', 'duplicate', 'opted_out', 'invalid'))
      );

      -- Messages table
      CREATE TABLE IF NOT EXISTS messages (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
          message_type VARCHAR(20) NOT NULL,
          template_name VARCHAR(100) NOT NULL,
          recipient_phone VARCHAR(20),
          recipient_email VARCHAR(255),
          subject VARCHAR(255),
          content TEXT NOT NULL,
          
          -- Personalization data
          personalized_data JSONB,
          affiliate_links JSONB,
          
          -- Delivery tracking
          status VARCHAR(50) DEFAULT 'pending',
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
      CREATE TABLE IF NOT EXISTS message_templates (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          name VARCHAR(100) UNIQUE NOT NULL,
          type VARCHAR(20) NOT NULL,
          subject VARCHAR(255),
          content TEXT NOT NULL,
          variables JSONB,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          
          CONSTRAINT templates_type_check CHECK (type IN ('sms', 'email'))
      );

      -- Opt-outs table
      CREATE TABLE IF NOT EXISTS opt_outs (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          phone VARCHAR(20),
          email VARCHAR(255),
          lead_id UUID REFERENCES leads(id),
          opt_out_type VARCHAR(20) NOT NULL,
          opted_out_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          source VARCHAR(100),
          
          CONSTRAINT opt_outs_type_check CHECK (opt_out_type IN ('sms', 'email', 'all')),
          CONSTRAINT opt_outs_contact_check CHECK (phone IS NOT NULL OR email IS NOT NULL)
      );

      -- Import logs
      CREATE TABLE IF NOT EXISTS import_logs (
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
      CREATE TABLE IF NOT EXISTS system_settings (
          key VARCHAR(100) PRIMARY KEY,
          value TEXT NOT NULL,
          description TEXT,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    logger.info('Creating main tables...');
    await query(mainSchema);

    // Step 2: Create Florida-specific tables
    const floridaSchema = `
      -- Florida officer information
      CREATE TABLE IF NOT EXISTS lead_officers (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          title VARCHAR(100),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Contact enrichment logs
      CREATE TABLE IF NOT EXISTS contact_enrichment_log (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
          phones_found INTEGER DEFAULT 0,
          emails_found INTEGER DEFAULT 0,
          website_found BOOLEAN DEFAULT false,
          sources JSONB,
          enrichment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          success BOOLEAN DEFAULT false,
          error_message TEXT,
          processing_time_ms INTEGER
      );

      -- Florida file downloads
      CREATE TABLE IF NOT EXISTS florida_file_downloads (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          filename VARCHAR(255) NOT NULL,
          file_size BIGINT,
          download_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          processed_date TIMESTAMP,
          records_found INTEGER,
          records_imported INTEGER,
          status VARCHAR(50) DEFAULT 'downloaded',
          error_details JSONB
      );
    `;

    logger.info('Creating Florida tables...');
    await query(floridaSchema);

    // Step 3: Add Florida columns to leads table
    const floridaColumns = `
      -- Add Florida-specific columns if they don't exist
      DO $$ 
      BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                         WHERE table_name = 'leads' AND column_name = 'officers') THEN
              ALTER TABLE leads ADD COLUMN officers JSONB;
          END IF;
          
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                         WHERE table_name = 'leads' AND column_name = 'enrichment_status') THEN
              ALTER TABLE leads ADD COLUMN enrichment_status VARCHAR(50) DEFAULT 'pending';
          END IF;
          
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                         WHERE table_name = 'leads' AND column_name = 'last_enrichment_attempt') THEN
              ALTER TABLE leads ADD COLUMN last_enrichment_attempt TIMESTAMP;
          END IF;
          
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                         WHERE table_name = 'leads' AND column_name = 'contact_sources') THEN
              ALTER TABLE leads ADD COLUMN contact_sources JSONB;
          END IF;
      END $$;
    `;

    logger.info('Adding Florida columns...');
    await query(floridaColumns);

    // Step 4: Create indexes
    const indexes = `
      -- Create indexes if they don't exist
      CREATE INDEX IF NOT EXISTS idx_leads_state ON leads(state);
      CREATE INDEX IF NOT EXISTS idx_leads_business_type ON leads(business_type);
      CREATE INDEX IF NOT EXISTS idx_leads_registration_date ON leads(registration_date);
      CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
      CREATE INDEX IF NOT EXISTS idx_leads_dedup_hash ON leads(dedup_hash);
      CREATE INDEX IF NOT EXISTS idx_leads_import_date ON leads(import_date);
      CREATE INDEX IF NOT EXISTS idx_leads_enrichment_status ON leads(enrichment_status);

      CREATE INDEX IF NOT EXISTS idx_messages_lead_id ON messages(lead_id);
      CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(message_type);
      CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
      CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON messages(sent_at);

      CREATE INDEX IF NOT EXISTS idx_contact_enrichment_lead_id ON contact_enrichment_log(lead_id);
      CREATE INDEX IF NOT EXISTS idx_contact_enrichment_date ON contact_enrichment_log(enrichment_date);
    `;

    logger.info('Creating indexes...');
    await query(indexes);

    // Step 5: Insert default data
    const defaultData = `
      -- Insert default message templates
      INSERT INTO message_templates (name, type, subject, content, variables) VALUES
      ('llc_welcome_sms', 'sms', NULL, 
      'Hi {{company_name}}! Congrats on your new LLC! Need help with EIN, banking, or accounting? Check out our resources: {{affiliate_link}} Reply STOP to opt out.',
      '["company_name", "affiliate_link"]'),

      ('llc_welcome_email', 'email', 'Welcome {{company_name}} - Essential LLC Resources Inside',
      'Hi there! Congratulations on registering {{company_name}} as an LLC! Starting a business is exciting, and we want to help you get set up for success.',
      '["company_name", "ein_link", "banking_link", "accounting_link", "insurance_link", "unsubscribe_link"]')
      ON CONFLICT (name) DO NOTHING;

      -- Insert default system settings
      INSERT INTO system_settings (key, value, description) VALUES
      ('daily_message_limit', '1000', 'Maximum messages to send per day'),
      ('hourly_message_limit', '100', 'Maximum messages to send per hour'),
      ('dedup_window_days', '30', 'Days to look back for duplicate detection'),
      ('auto_campaign_enabled', 'true', 'Enable automatic campaign processing'),
      ('message_delay_seconds', '5', 'Delay between individual messages')
      ON CONFLICT (key) DO NOTHING;
    `;

    logger.info('Inserting default data...');
    await query(defaultData);

    logger.info('✅ Database setup completed successfully!');

    // Show summary
    const summary = await query(`
      SELECT 
        (SELECT COUNT(*) FROM leads) as leads_count,
        (SELECT COUNT(*) FROM message_templates) as templates_count,
        (SELECT COUNT(*) FROM system_settings) as settings_count
    `);

    const stats = summary.rows[0];
    console.log('\n📊 Database Summary:');
    console.log(`Leads: ${stats.leads_count}`);
    console.log(`Templates: ${stats.templates_count}`);
    console.log(`Settings: ${stats.settings_count}`);
    console.log('\n✅ Ready for testing!');

  } catch (err) {
    logger.error('Database setup failed', { error: err.message });
    console.error('❌ Setup failed:', err.message);
    throw err;
  } finally {
    await closePool();
  }
}

// Run if called directly
if (require.main === module) {
  setupDatabase();
}

module.exports = { setupDatabase };
