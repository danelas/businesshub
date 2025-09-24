#!/usr/bin/env node

require('dotenv').config();
const FloridaDataService = require('./src/services/floridaDataService');
const ContactEnrichmentService = require('./src/services/contactEnrichmentService');
const { query, closePool, logger } = require('./src/database/connection');

async function testFloridaPipeline() {
  console.log('🧪 Testing Florida LLC Data Pipeline\n');
  
  try {
    // Initialize services
    const floridaService = new FloridaDataService();
    const enrichmentService = new ContactEnrichmentService();
    
    console.log('📋 Step 1: Testing SFTP Connection');
    console.log('─'.repeat(50));
    
    try {
      const availableFiles = await floridaService.listAvailableFiles();
      console.log(`✅ SFTP Connection successful!`);
      console.log(`📁 Found ${availableFiles.length} files on server:`);
      
      availableFiles.slice(0, 5).forEach((file, index) => {
        const size = (file.size / 1024 / 1024).toFixed(2);
        const date = new Date(file.modifyTime).toLocaleDateString();
        console.log(`   ${index + 1}. ${file.name} (${size} MB, ${date})`);
      });
      
      if (availableFiles.length > 5) {
        console.log(`   ... and ${availableFiles.length - 5} more files`);
      }
    } catch (err) {
      console.log(`❌ SFTP Connection failed: ${err.message}`);
      console.log('   This might be due to network restrictions or server availability');
    }
    
    console.log('\n📥 Step 2: Testing File Download (Limited)');
    console.log('─'.repeat(50));
    
    try {
      // Try to download just one file for testing
      const downloadResult = await floridaService.downloadFiles([]);
      
      if (downloadResult.length > 0) {
        console.log(`✅ Downloaded ${downloadResult.length} files:`);
        downloadResult.forEach(file => {
          const size = (file.size / 1024 / 1024).toFixed(2);
          console.log(`   • ${file.fileName} (${size} MB)`);
        });
      } else {
        console.log('ℹ️  No new files to download (files may already exist)');
      }
    } catch (err) {
      console.log(`❌ Download failed: ${err.message}`);
      console.log('   Creating mock data for testing...');
      
      // Create mock Florida LLC data for testing
      await createMockFloridaData();
    }
    
    console.log('\n🔄 Step 3: Testing Data Processing');
    console.log('─'.repeat(50));
    
    try {
      const processResult = await floridaService.processFloridaFiles(30); // Last 30 days for testing
      console.log(`✅ Processed ${processResult.processed} files`);
      console.log(`📊 Found ${processResult.newRecords} new LLC records`);
    } catch (err) {
      console.log(`❌ Processing failed: ${err.message}`);
      console.log('   This might be due to file format or missing files');
    }
    
    console.log('\n🔍 Step 4: Testing Contact Enrichment');
    console.log('─'.repeat(50));
    
    // Get some leads to test enrichment
    const leadsResult = await query(`
      SELECT id, company_name, city, state, phone, email 
      FROM leads 
      WHERE state = 'FL' 
        AND (phone IS NULL OR email IS NULL)
        AND company_name IS NOT NULL
      ORDER BY registration_date DESC 
      LIMIT 3
    `);
    
    if (leadsResult.rows.length === 0) {
      console.log('ℹ️  No Florida leads found for enrichment testing');
      console.log('   Creating test lead...');
      
      // Create a test lead
      const testLead = await createTestLead();
      if (testLead) {
        await testContactEnrichment(enrichmentService, testLead);
      }
    } else {
      console.log(`📋 Found ${leadsResult.rows.length} leads for enrichment testing:`);
      
      for (const lead of leadsResult.rows) {
        console.log(`\n🏢 Testing: ${lead.company_name} (${lead.city || 'Unknown City'})`);
        console.log(`   Current: Phone=${lead.phone || 'None'}, Email=${lead.email || 'None'}`);
        
        try {
          const enrichResult = await enrichmentService.enrichLead(lead.id);
          
          console.log(`   ✅ Enrichment completed:`);
          console.log(`      📞 Phones found: ${enrichResult.foundContacts.phones.length}`);
          console.log(`      📧 Emails found: ${enrichResult.foundContacts.emails.length}`);
          console.log(`      🌐 Website: ${enrichResult.foundContacts.website || 'None'}`);
          console.log(`      📊 Sources: ${enrichResult.sources.join(', ')}`);
          
          if (enrichResult.foundContacts.phones.length > 0) {
            console.log(`      📞 Phone numbers: ${enrichResult.foundContacts.phones.join(', ')}`);
          }
          
          if (enrichResult.foundContacts.emails.length > 0) {
            console.log(`      📧 Email addresses: ${enrichResult.foundContacts.emails.join(', ')}`);
          }
          
        } catch (err) {
          console.log(`   ❌ Enrichment failed: ${err.message}`);
        }
        
        // Add delay between enrichments to be respectful
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
    
    console.log('\n📊 Step 5: Pipeline Summary');
    console.log('─'.repeat(50));
    
    // Get overall statistics
    const statsResult = await query(`
      SELECT 
        COUNT(*) as total_florida_llcs,
        COUNT(CASE WHEN phone IS NOT NULL THEN 1 END) as with_phone,
        COUNT(CASE WHEN email IS NOT NULL THEN 1 END) as with_email,
        COUNT(CASE WHEN website IS NOT NULL THEN 1 END) as with_website
      FROM leads 
      WHERE state = 'FL' 
        AND registration_date >= CURRENT_DATE - INTERVAL '30 days'
    `);
    
    if (statsResult.rows.length > 0) {
      const stats = statsResult.rows[0];
      const phoneRate = stats.total_florida_llcs > 0 ? 
        ((stats.with_phone / stats.total_florida_llcs) * 100).toFixed(1) : 0;
      const emailRate = stats.total_florida_llcs > 0 ? 
        ((stats.with_email / stats.total_florida_llcs) * 100).toFixed(1) : 0;
      
      console.log(`📈 Florida LLC Statistics (Last 30 days):`);
      console.log(`   Total LLCs: ${stats.total_florida_llcs}`);
      console.log(`   With Phone: ${stats.with_phone} (${phoneRate}%)`);
      console.log(`   With Email: ${stats.with_email} (${emailRate}%)`);
      console.log(`   With Website: ${stats.with_website}`);
    }
    
    // Check enrichment performance
    const enrichmentStats = await query(`
      SELECT 
        COUNT(*) as total_attempts,
        COUNT(CASE WHEN success = true THEN 1 END) as successful,
        AVG(phones_found) as avg_phones,
        AVG(emails_found) as avg_emails
      FROM contact_enrichment_log 
      WHERE enrichment_date >= CURRENT_DATE - INTERVAL '7 days'
    `);
    
    if (enrichmentStats.rows.length > 0 && enrichmentStats.rows[0].total_attempts > 0) {
      const eStats = enrichmentStats.rows[0];
      const successRate = ((eStats.successful / eStats.total_attempts) * 100).toFixed(1);
      
      console.log(`\n🎯 Enrichment Performance (Last 7 days):`);
      console.log(`   Total Attempts: ${eStats.total_attempts}`);
      console.log(`   Success Rate: ${successRate}%`);
      console.log(`   Avg Phones Found: ${parseFloat(eStats.avg_phones || 0).toFixed(1)}`);
      console.log(`   Avg Emails Found: ${parseFloat(eStats.avg_emails || 0).toFixed(1)}`);
    }
    
    console.log('\n✅ Florida Pipeline Test Completed!');
    console.log('\n🚀 Next Steps:');
    console.log('1. Set up automated daily sync: npm run worker');
    console.log('2. Create sequence campaigns for new Florida LLCs');
    console.log('3. Monitor enrichment performance via API');
    
  } catch (err) {
    console.error(`❌ Test failed: ${err.message}`);
    logger.error('Florida pipeline test failed', { error: err.message, stack: err.stack });
  } finally {
    await closePool();
  }
}

async function createMockFloridaData() {
  console.log('   📝 Creating mock Florida LLC data for testing...');
  
  const mockLLCs = [
    {
      company_name: 'Sunshine Consulting LLC',
      city: 'Miami',
      business_type: 'LLC',
      registration_date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) // 2 days ago
    },
    {
      company_name: 'Palm Beach Marketing PLLC',
      city: 'Palm Beach',
      business_type: 'PLLC',
      registration_date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) // 1 day ago
    },
    {
      company_name: 'Orlando Tech Solutions LLC',
      city: 'Orlando',
      business_type: 'LLC',
      registration_date: new Date() // Today
    }
  ];
  
  for (const llc of mockLLCs) {
    try {
      const crypto = require('crypto');
      const dedupHash = crypto.createHash('sha256')
        .update(`${llc.company_name.toLowerCase()}|FL`)
        .digest('hex');
      
      await query(`
        INSERT INTO leads (
          company_name, state, city, business_type, registration_date, 
          status, source, dedup_hash, import_date
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
        ON CONFLICT (dedup_hash) DO NOTHING
      `, [
        llc.company_name, 'FL', llc.city, llc.business_type,
        llc.registration_date.toISOString().split('T')[0],
        'active', 'mock_test', dedupHash
      ]);
      
      console.log(`   ✅ Created: ${llc.company_name}`);
    } catch (err) {
      console.log(`   ⚠️  Skipped: ${llc.company_name} (may already exist)`);
    }
  }
}

async function createTestLead() {
  try {
    const crypto = require('crypto');
    const testCompany = 'Florida Test Business LLC';
    const dedupHash = crypto.createHash('sha256')
      .update(`${testCompany.toLowerCase()}|FL`)
      .digest('hex');
    
    const result = await query(`
      INSERT INTO leads (
        company_name, state, city, business_type, registration_date, 
        status, source, dedup_hash, import_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
      ON CONFLICT (dedup_hash) DO UPDATE SET
        company_name = EXCLUDED.company_name
      RETURNING id, company_name, city
    `, [
      testCompany, 'FL', 'Tampa', 'LLC',
      new Date().toISOString().split('T')[0],
      'active', 'test_enrichment', dedupHash
    ]);
    
    return result.rows[0];
  } catch (err) {
    console.log(`   ❌ Failed to create test lead: ${err.message}`);
    return null;
  }
}

async function testContactEnrichment(enrichmentService, lead) {
  console.log(`🔍 Testing contact enrichment for: ${lead.company_name}`);
  
  try {
    const result = await enrichmentService.enrichLead(lead.id);
    
    console.log(`✅ Enrichment Results:`);
    console.log(`   📞 Phones: ${result.foundContacts.phones.length}`);
    console.log(`   📧 Emails: ${result.foundContacts.emails.length}`);
    console.log(`   🌐 Website: ${result.foundContacts.website || 'None'}`);
    console.log(`   📊 Sources: ${result.sources.join(', ')}`);
    
  } catch (err) {
    console.log(`❌ Enrichment failed: ${err.message}`);
  }
}

// Handle process signals
process.on('SIGINT', async () => {
  console.log('\n🛑 Test interrupted by user');
  await closePool();
  process.exit(1);
});

// Run the test
if (require.main === module) {
  testFloridaPipeline();
}

module.exports = { testFloridaPipeline };
