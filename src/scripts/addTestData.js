require('dotenv').config();
const { query, closePool, logger } = require('../database/connection');

// Sample Florida LLC data for testing
const sampleLLCs = [
  {
    company_name: 'Sunshine Tech Solutions LLC',
    city: 'Miami',
    zip_code: '33101',
    business_type: 'LLC',
    registration_date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
    address_line1: '123 Biscayne Blvd'
  },
  {
    company_name: 'Florida Digital Marketing LLC',
    city: 'Orlando',
    zip_code: '32801',
    business_type: 'LLC', 
    registration_date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
    address_line1: '456 Orange Ave'
  },
  {
    company_name: 'Coastal Consulting Group LLC',
    city: 'Tampa',
    zip_code: '33602',
    business_type: 'LLC',
    registration_date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
    address_line1: '789 Bay Street'
  },
  {
    company_name: 'Palm Beach Properties LLC',
    city: 'West Palm Beach',
    zip_code: '33401',
    business_type: 'LLC',
    registration_date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
    address_line1: '321 Clematis St'
  },
  {
    company_name: 'Everglades Adventure Tours LLC',
    city: 'Fort Lauderdale',
    zip_code: '33301',
    business_type: 'LLC',
    registration_date: new Date(), // Today
    address_line1: '654 Las Olas Blvd'
  },
  {
    company_name: 'Jacksonville Logistics LLC',
    city: 'Jacksonville',
    zip_code: '32202',
    business_type: 'LLC',
    registration_date: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000), // 4 days ago
    address_line1: '987 Main St'
  },
  {
    company_name: 'Keys Marine Services LLC',
    city: 'Key West',
    zip_code: '33040',
    business_type: 'LLC',
    registration_date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
    address_line1: '147 Duval St'
  },
  {
    company_name: 'Space Coast Technology LLC',
    city: 'Melbourne',
    zip_code: '32901',
    business_type: 'LLC',
    registration_date: new Date(), // Today
    address_line1: '258 NASA Blvd'
  },
  {
    company_name: 'Panhandle Construction LLC',
    city: 'Pensacola',
    zip_code: '32501',
    business_type: 'LLC',
    registration_date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
    address_line1: '369 Government St'
  },
  {
    company_name: 'Central Florida Catering LLC',
    city: 'Lakeland',
    zip_code: '33801',
    business_type: 'LLC',
    registration_date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
    address_line1: '741 Memorial Blvd'
  }
];

async function addTestData() {
  try {
    logger.info('Adding test Florida LLC data...');

    for (const llc of sampleLLCs) {
      // Generate deduplication hash
      const dedupString = `${llc.company_name.toLowerCase()}_FL`;
      const dedupHash = require('crypto').createHash('md5').update(dedupString).digest('hex');

      // Insert LLC data
      const result = await query(`
        INSERT INTO leads (
          company_name, state, city, zip_code, business_type, 
          registration_date, address_line1, source, 
          dedup_hash, enrichment_status
        ) VALUES ($1, 'FL', $2, $3, $4, $5, $6, 'test_data', $7, 'pending')
        ON CONFLICT (dedup_hash) DO NOTHING
        RETURNING id
      `, [
        llc.company_name,
        llc.city,
        llc.zip_code,
        llc.business_type,
        llc.registration_date,
        llc.address_line1,
        dedupHash
      ]);

      if (result.rows.length > 0) {
        logger.info(`Added LLC: ${llc.company_name}`, { id: result.rows[0].id });
      } else {
        logger.info(`LLC already exists: ${llc.company_name}`);
      }
    }

    // Add some sample enriched data
    const enrichedSamples = [
      {
        name: 'Sunshine Tech Solutions LLC',
        phone: '+13055551234',
        email: 'info@sunshinetechsolutions.com',
        website: 'https://www.sunshinetechsolutions.com'
      },
      {
        name: 'Florida Digital Marketing LLC',
        phone: '+14075555678',
        email: 'contact@floridadigitalmarketing.com',
        website: 'https://www.floridadigitalmarketing.com'
      },
      {
        name: 'Coastal Consulting Group LLC',
        phone: '+18135559012',
        email: 'hello@coastalconsulting.com',
        website: 'https://www.coastalconsulting.com'
      }
    ];

    for (const enriched of enrichedSamples) {
      await query(`
        UPDATE leads 
        SET phone = $1, 
            email = $2, 
            website = $3,
            enrichment_status = 'completed',
            last_enrichment_attempt = CURRENT_TIMESTAMP,
            contact_sources = $4
        WHERE company_name = $5 AND state = 'FL'
      `, [
        enriched.phone,
        enriched.email,
        enriched.website,
        JSON.stringify(['test_enrichment']),
        enriched.name
      ]);

      logger.info(`Enriched LLC: ${enriched.name}`);
    }

    // Log import record
    await query(`
      INSERT INTO import_logs (
        filename, source, total_records, processed_records, 
        new_records, duplicate_records, status
      ) VALUES (
        'test_data.json', 'test_script', $1, $1, $1, 0, 'completed'
      )
    `, [sampleLLCs.length]);

    logger.info(`Test data setup completed! Added ${sampleLLCs.length} Florida LLCs.`);
    
    // Show summary
    const summary = await query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN phone IS NOT NULL THEN 1 END) as with_phone,
        COUNT(CASE WHEN email IS NOT NULL THEN 1 END) as with_email
      FROM leads WHERE state = 'FL'
    `);

    const stats = summary.rows[0];
    console.log('\n📊 Florida LLC Summary:');
    console.log(`Total LLCs: ${stats.total}`);
    console.log(`With Phone: ${stats.with_phone}`);
    console.log(`With Email: ${stats.with_email}`);
    console.log('\n🎯 Next Steps:');
    console.log('1. Deploy your app to Render');
    console.log('2. Visit: https://your-app.onrender.com/api/test/dashboard');
    console.log('3. Test the contact enrichment feature');
    console.log('4. View all phone numbers and contact info');

  } catch (err) {
    logger.error('Failed to add test data', { error: err.message });
    console.error('Error:', err.message);
  } finally {
    await closePool();
  }
}

// Run if called directly
if (require.main === module) {
  addTestData();
}

module.exports = { addTestData };
