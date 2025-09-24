#!/usr/bin/env node

require('dotenv').config();
const FloridaDataService = require('../services/floridaDataService');
const ContactEnrichmentService = require('../services/contactEnrichmentService');
const { closePool, logger } = require('../database/connection');

// Command line argument parsing
const args = process.argv.slice(2);

const showHelp = () => {
  console.log(`
Florida LLC Data Sync Script

Usage:
  node floridaSync.js [options]

Options:
  --download-only         Only download files, don't process them
  --process-only          Only process existing files, don't download new ones
  --enrich-contacts       Run contact enrichment after processing
  --days-back <number>    Number of days back to filter LLC formations (default: 7)
  --enrich-limit <number> Maximum leads to enrich in one run (default: 50)
  --list-files           List available files on SFTP server
  --help                 Show this help message

Examples:
  # Full sync (download, process, and enrich)
  node floridaSync.js --enrich-contacts

  # Download and process only LLCs from last 3 days
  node floridaSync.js --days-back 3

  # Only run contact enrichment on existing leads
  node floridaSync.js --process-only --enrich-contacts --enrich-limit 100

  # List available files on Florida SFTP
  node floridaSync.js --list-files
  `);
};

const parseArgs = (args) => {
  const options = {
    downloadOnly: false,
    processOnly: false,
    enrichContacts: false,
    daysBack: 7,
    enrichLimit: 50,
    listFiles: false,
    help: false
  };
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--download-only':
        options.downloadOnly = true;
        break;
      case '--process-only':
        options.processOnly = true;
        break;
      case '--enrich-contacts':
        options.enrichContacts = true;
        break;
      case '--days-back':
        options.daysBack = parseInt(args[++i]) || 7;
        break;
      case '--enrich-limit':
        options.enrichLimit = parseInt(args[++i]) || 50;
        break;
      case '--list-files':
        options.listFiles = true;
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

const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const formatDuration = (ms) => {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
};

const main = async () => {
  const startTime = Date.now();
  
  try {
    const options = parseArgs(args);
    
    if (options.help) {
      showHelp();
      process.exit(0);
    }
    
    console.log('🏢 Florida LLC Data Sync Starting...\n');
    
    const floridaService = new FloridaDataService();
    const enrichmentService = new ContactEnrichmentService();
    
    let results = {
      filesDownloaded: 0,
      filesProcessed: 0,
      newRecords: 0,
      enrichedLeads: 0
    };
    
    // List files option
    if (options.listFiles) {
      console.log('📋 Listing available files on Florida SFTP...\n');
      
      const files = await floridaService.listAvailableFiles();
      
      if (files.length === 0) {
        console.log('No files found on SFTP server.');
      } else {
        console.log('Available Files:');
        console.log('─'.repeat(80));
        files.forEach((file, index) => {
          const size = formatFileSize(file.size);
          const date = new Date(file.modifyTime).toLocaleDateString();
          console.log(`${index + 1}. ${file.name}`);
          console.log(`   Size: ${size} | Modified: ${date} | Type: ${file.type}`);
          console.log('');
        });
      }
      
      return;
    }
    
    // Download phase
    if (!options.processOnly) {
      console.log('📥 Downloading Florida LLC files...');
      
      const downloadResult = await floridaService.downloadFiles();
      results.filesDownloaded = downloadResult.length;
      
      if (downloadResult.length > 0) {
        console.log(`✅ Downloaded ${downloadResult.length} files:`);
        downloadResult.forEach(file => {
          const size = formatFileSize(file.size);
          console.log(`   • ${file.fileName} (${size})`);
        });
      } else {
        console.log('ℹ️  No new files to download');
      }
      
      console.log('');
    }
    
    // Process phase
    if (!options.downloadOnly) {
      console.log(`🔄 Processing Florida LLC data (last ${options.daysBack} days)...`);
      
      const processResult = await floridaService.processFloridaFiles(options.daysBack);
      results.filesProcessed = processResult.processed;
      results.newRecords = processResult.newRecords;
      
      console.log(`✅ Processed ${processResult.processed} files`);
      console.log(`📊 Found ${processResult.newRecords} new LLC records`);
      console.log('');
    }
    
    // Contact enrichment phase
    if (options.enrichContacts) {
      console.log(`🔍 Enriching contact information (limit: ${options.enrichLimit})...`);
      
      const enrichResult = await enrichmentService.enrichLeadsWithoutContacts(options.enrichLimit);
      results.enrichedLeads = enrichResult.enriched;
      
      console.log(`✅ Processed ${enrichResult.processed} leads for enrichment`);
      console.log(`📞 Successfully enriched ${enrichResult.enriched} leads with contact info`);
      console.log('');
    }
    
    // Summary
    const duration = formatDuration(Date.now() - startTime);
    
    console.log('📈 Sync Summary:');
    console.log('─'.repeat(50));
    console.log(`Files Downloaded:    ${results.filesDownloaded}`);
    console.log(`Files Processed:     ${results.filesProcessed}`);
    console.log(`New LLC Records:     ${results.newRecords}`);
    console.log(`Enriched Leads:      ${results.enrichedLeads}`);
    console.log(`Total Duration:      ${duration}`);
    
    if (results.newRecords > 0) {
      console.log('\n🎯 Next Steps:');
      console.log('1. Review new leads in the dashboard');
      console.log('2. Create sequence campaigns for new LLCs');
      console.log('3. Monitor message delivery and engagement');
    }
    
    console.log('\n✅ Florida LLC sync completed successfully!');
    
  } catch (err) {
    console.error(`❌ Florida sync failed: ${err.message}`);
    logger.error('Florida sync script failed', { error: err.message, stack: err.stack });
    process.exit(1);
  } finally {
    await closePool();
  }
};

// Handle process signals
process.on('SIGINT', async () => {
  console.log('\n🛑 Florida sync interrupted by user');
  await closePool();
  process.exit(1);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Florida sync terminated');
  await closePool();
  process.exit(1);
});

// Run the script
if (require.main === module) {
  main();
}

module.exports = { main };
