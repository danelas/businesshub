#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const { query, closePool, logger } = require('../database/connection');

const loadTemplates = async () => {
  try {
    logger.info('Loading message templates...');
    
    // Read the templates SQL file
    const templatesPath = path.join(__dirname, '../database/templates.sql');
    const templatesSQL = await fs.readFile(templatesPath, 'utf8');
    
    // Split by semicolon and execute each statement
    const statements = templatesSQL
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    logger.info(`Executing ${statements.length} template statements...`);
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const statement of statements) {
      try {
        await query(statement);
        successCount++;
        logger.debug('Template statement executed successfully');
      } catch (err) {
        errorCount++;
        if (err.message.includes('duplicate key')) {
          logger.warn('Template already exists, skipping', { error: err.message });
        } else {
          logger.error('Template statement failed', { 
            statement: statement.substring(0, 100), 
            error: err.message 
          });
        }
      }
    }
    
    // Verify templates were loaded
    const templateResult = await query(`
      SELECT name, type, is_active 
      FROM message_templates 
      WHERE name LIKE 'llc_day%'
      ORDER BY name
    `);
    
    console.log('\n📧 Loaded Message Templates:');
    console.log('─'.repeat(60));
    
    const templates = templateResult.rows;
    templates.forEach(template => {
      const status = template.is_active ? '✅' : '❌';
      console.log(`${status} ${template.name} (${template.type})`);
    });
    
    console.log('\n📊 Template Loading Results:');
    console.log('─'.repeat(40));
    console.log(`✅ Successful: ${successCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log(`📝 Total Templates: ${templates.length}`);
    
    if (templates.length > 0) {
      console.log('\n🎯 Ready-to-Use Templates:');
      console.log('─'.repeat(50));
      console.log('Day 1 - EIN/Tax ID:');
      console.log('  • llc_day1_ein_sms');
      console.log('  • llc_day1_ein_email');
      console.log('Day 3-5 - Business Banking:');
      console.log('  • llc_day3_banking_sms');
      console.log('  • llc_day3_banking_email');
      console.log('Day 7-10 - Accounting:');
      console.log('  • llc_day7_accounting_sms');
      console.log('  • llc_day7_accounting_email');
      console.log('Day 10-14 - Compliance:');
      console.log('  • llc_day10_compliance_sms');
      console.log('  • llc_day10_compliance_email');
      console.log('Day 15+ - Insurance:');
      console.log('  • llc_day15_insurance_sms');
      console.log('  • llc_day15_insurance_email');
      
      console.log('\n🚀 Next Steps:');
      console.log('1. Create a sequence campaign: POST /api/sequences/llc-sequence');
      console.log('2. Import LLC leads with registration dates');
      console.log('3. The worker will automatically process the sequence');
    }
    
    logger.info('Template loading completed', { 
      success: successCount, 
      errors: errorCount, 
      totalTemplates: templates.length 
    });
    
  } catch (err) {
    console.error(`❌ Failed to load templates: ${err.message}`);
    logger.error('Template loading failed', { error: err.message, stack: err.stack });
    process.exit(1);
  } finally {
    await closePool();
  }
};

// Handle process signals
process.on('SIGINT', async () => {
  console.log('\n🛑 Template loading interrupted');
  await closePool();
  process.exit(1);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Template loading terminated');
  await closePool();
  process.exit(1);
});

// Run the script
if (require.main === module) {
  console.log('🔄 Loading LLC message templates...\n');
  loadTemplates();
}

module.exports = { loadTemplates };
