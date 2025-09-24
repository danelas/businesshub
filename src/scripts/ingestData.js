#!/usr/bin/env node

const path = require('path');
const fs = require('fs').promises;
const DataIngestionService = require('../services/dataIngestion');
const { logger, closePool } = require('../database/connection');

// Command line argument parsing
const args = process.argv.slice(2);

const showHelp = () => {
  console.log(`
LLC Data Ingestion Script

Usage:
  node ingestData.js [options]

Options:
  --file <path>           Import from CSV file
  --api <url>             Import from API endpoint
  --state <code>          State code for API import (required with --api)
  --key <apikey>          API key for authenticated endpoints
  --source <name>         Source identifier (default: csv_import or api_import)
  --help                  Show this help message

Examples:
  # Import from CSV file
  node ingestData.js --file ./data/california_llcs.csv --source ca_state_registry

  # Import from API
  node ingestData.js --api https://api.example.com/llcs --state CA --key YOUR_API_KEY

  # Import with custom source name
  node ingestData.js --file ./data/texas_llcs.csv --source tx_manual_import
  `);
};

const parseArgs = (args) => {
  const options = {};
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--file':
        options.file = args[++i];
        break;
      case '--api':
        options.api = args[++i];
        break;
      case '--state':
        options.state = args[++i];
        break;
      case '--key':
        options.key = args[++i];
        break;
      case '--source':
        options.source = args[++i];
        break;
      case '--help':
        options.help = true;
        break;
      default:
        console.error(`Unknown option: ${args[i]}`);
        process.exit(1);
    }
  }
  
  return options;
};

const validateFile = async (filePath) => {
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      throw new Error('Path is not a file');
    }
    
    if (!filePath.toLowerCase().endsWith('.csv')) {
      throw new Error('File must be a CSV file');
    }
    
    return true;
  } catch (err) {
    throw new Error(`Invalid file: ${err.message}`);
  }
};

const validateApiOptions = (options) => {
  if (!options.api) {
    throw new Error('API URL is required');
  }
  
  if (!options.state) {
    throw new Error('State code is required for API import');
  }
  
  if (options.state.length !== 2) {
    throw new Error('State code must be 2 characters');
  }
  
  try {
    new URL(options.api);
  } catch (err) {
    throw new Error('Invalid API URL');
  }
};

const formatResults = (result) => {
  const { totalProcessed, newRecords, duplicateRecords, errorRecords, validationErrors } = result;
  
  console.log('\n📊 Import Results:');
  console.log('─'.repeat(50));
  console.log(`Total Processed:    ${totalProcessed.toLocaleString()}`);
  console.log(`New Records:        ${newRecords.toLocaleString()}`);
  console.log(`Duplicates:         ${duplicateRecords.toLocaleString()}`);
  console.log(`Errors:             ${errorRecords.toLocaleString()}`);
  
  const successRate = totalProcessed > 0 ? ((newRecords / totalProcessed) * 100).toFixed(2) : 0;
  console.log(`Success Rate:       ${successRate}%`);
  
  if (validationErrors && validationErrors.length > 0) {
    console.log('\n⚠️  Validation Errors (first 5):');
    console.log('─'.repeat(50));
    validationErrors.slice(0, 5).forEach((error, index) => {
      console.log(`${index + 1}. Line ${error.line}: ${error.errors.join(', ')}`);
    });
    
    if (validationErrors.length > 5) {
      console.log(`... and ${validationErrors.length - 5} more errors`);
    }
  }
};

const main = async () => {
  try {
    const options = parseArgs(args);
    
    if (options.help || args.length === 0) {
      showHelp();
      process.exit(0);
    }
    
    const dataIngestion = new DataIngestionService();
    let result;
    
    if (options.file) {
      // CSV Import
      console.log('🔄 Starting CSV import...');
      
      const absolutePath = path.resolve(options.file);
      await validateFile(absolutePath);
      
      const source = options.source || 'csv_import';
      
      console.log(`📁 File: ${absolutePath}`);
      console.log(`📋 Source: ${source}`);
      
      const startTime = Date.now();
      result = await dataIngestion.importFromCSV(absolutePath, source);
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      
      console.log(`⏱️  Import completed in ${duration} seconds`);
      formatResults(result);
      
    } else if (options.api) {
      // API Import
      console.log('🔄 Starting API import...');
      
      validateApiOptions(options);
      
      const source = options.source || 'api_import';
      
      console.log(`🌐 API: ${options.api}`);
      console.log(`🏛️  State: ${options.state.toUpperCase()}`);
      console.log(`📋 Source: ${source}`);
      
      const startTime = Date.now();
      result = await dataIngestion.importFromAPI(options.api, options.key, options.state, source);
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      
      console.log(`⏱️  Import completed in ${duration} seconds`);
      formatResults(result);
      
    } else {
      console.error('❌ Error: Either --file or --api option is required');
      showHelp();
      process.exit(1);
    }
    
    console.log('\n✅ Import completed successfully!');
    
  } catch (err) {
    console.error(`❌ Import failed: ${err.message}`);
    logger.error('Data ingestion script failed', { error: err.message, stack: err.stack });
    process.exit(1);
  } finally {
    await closePool();
  }
};

// Handle process signals
process.on('SIGINT', async () => {
  console.log('\n🛑 Import interrupted by user');
  await closePool();
  process.exit(1);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Import terminated');
  await closePool();
  process.exit(1);
});

// Run the script
main();
