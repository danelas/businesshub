const fs = require('fs').promises;
const path = require('path');
const { query, testConnection, closePool, logger } = require('./connection');

const runMigration = async () => {
  try {
    logger.info('Starting database migration...');
    
    // Test connection first
    const connected = await testConnection();
    if (!connected) {
      throw new Error('Could not connect to database');
    }
    
    // Read and execute schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = await fs.readFile(schemaPath, 'utf8');
    
    // Split by semicolon and execute each statement
    const statements = schema
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    logger.info(`Executing ${statements.length} SQL statements...`);
    
    for (const statement of statements) {
      try {
        await query(statement);
        logger.debug('Executed statement successfully');
      } catch (err) {
        // Log but continue for statements that might already exist
        if (err.message.includes('already exists')) {
          logger.warn('Statement skipped (already exists)', { error: err.message });
        } else {
          logger.error('Statement failed', { statement: statement.substring(0, 100), error: err.message });
          throw err;
        }
      }
    }
    
    logger.info('Database migration completed successfully');
    
  } catch (err) {
    logger.error('Migration failed', { error: err.message });
    process.exit(1);
  } finally {
    await closePool();
  }
};

// Run migration if called directly
if (require.main === module) {
  runMigration();
}

module.exports = { runMigration };
