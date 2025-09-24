const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const csv = require('csv-parser');
const { Client } = require('ssh2-sftp-client');
const { query, transaction, logger } = require('../database/connection');

class FloridaDataService {
  constructor() {
    this.sftpConfig = {
      host: 'sftp.floridados.gov',
      port: 22,
      username: 'Public',
      password: 'PubAccess1845!'
    };
    
    this.downloadDir = path.join(__dirname, '../../downloads/florida');
    this.processedDir = path.join(__dirname, '../../downloads/florida/processed');
    
    // Ensure directories exist
    this.ensureDirectories();
  }

  async ensureDirectories() {
    try {
      await fs.mkdir(this.downloadDir, { recursive: true });
      await fs.mkdir(this.processedDir, { recursive: true });
    } catch (err) {
      logger.error('Failed to create directories', { error: err.message });
    }
  }

  // Connect to Florida SFTP server and list available files
  async listAvailableFiles() {
    const sftp = new Client();
    
    try {
      logger.info('Connecting to Florida SFTP server...');
      await sftp.connect(this.sftpConfig);
      
      // List files in the root directory
      const fileList = await sftp.list('/');
      
      // Filter for relevant files (typically CSV or text files)
      const relevantFiles = fileList.filter(file => {
        const name = file.name.toLowerCase();
        return (name.includes('corp') || name.includes('llc') || name.includes('business')) &&
               (name.endsWith('.csv') || name.endsWith('.txt') || name.endsWith('.zip'));
      });
      
      logger.info('Available files found', { count: relevantFiles.length });
      
      return relevantFiles.map(file => ({
        name: file.name,
        size: file.size,
        modifyTime: file.modifyTime,
        type: file.type
      }));
      
    } catch (err) {
      logger.error('Failed to list SFTP files', { error: err.message });
      throw err;
    } finally {
      await sftp.end();
    }
  }

  // Download files from Florida SFTP
  async downloadFiles(fileNames = []) {
    const sftp = new Client();
    const downloadedFiles = [];
    
    try {
      await sftp.connect(this.sftpConfig);
      
      // If no specific files provided, get the most recent ones
      if (fileNames.length === 0) {
        const availableFiles = await this.listAvailableFiles();
        
        // Sort by modification time (newest first) and take the most recent
        const recentFiles = availableFiles
          .sort((a, b) => new Date(b.modifyTime) - new Date(a.modifyTime))
          .slice(0, 5); // Download up to 5 most recent files
        
        fileNames = recentFiles.map(f => f.name);
      }
      
      logger.info('Starting file downloads', { files: fileNames });
      
      for (const fileName of fileNames) {
        try {
          const localPath = path.join(this.downloadDir, fileName);
          const remotePath = `/${fileName}`;
          
          // Check if file already exists and is recent
          const shouldDownload = await this.shouldDownloadFile(localPath, fileName);
          
          if (shouldDownload) {
            logger.info('Downloading file', { fileName, localPath });
            await sftp.fastGet(remotePath, localPath);
            
            downloadedFiles.push({
              fileName,
              localPath,
              downloadedAt: new Date(),
              size: (await fs.stat(localPath)).size
            });
            
            logger.info('File downloaded successfully', { fileName });
          } else {
            logger.info('File already exists and is recent, skipping', { fileName });
          }
          
        } catch (err) {
          logger.error('Failed to download file', { fileName, error: err.message });
        }
      }
      
    } catch (err) {
      logger.error('SFTP download failed', { error: err.message });
      throw err;
    } finally {
      await sftp.end();
    }
    
    return downloadedFiles;
  }

  // Check if we should download a file (if it doesn't exist or is old)
  async shouldDownloadFile(localPath, fileName) {
    try {
      const stats = await fs.stat(localPath);
      const fileAge = Date.now() - stats.mtime.getTime();
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours
      
      return fileAge > maxAge;
    } catch (err) {
      // File doesn't exist, should download
      return true;
    }
  }

  // Parse Florida LLC data from downloaded files
  async parseFloridaData(filePath, daysBack = 7) {
    const results = [];
    const errors = [];
    let lineNumber = 0;
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);
    
    logger.info('Parsing Florida data', { filePath, daysBack, cutoffDate });
    
    return new Promise((resolve, reject) => {
      const stream = fs.createReadStream(filePath)
        .pipe(csv({
          // Handle different possible column names
          mapHeaders: ({ header }) => {
            const normalized = header.toLowerCase().trim();
            
            // Map common variations to standard names
            const mappings = {
              'entity_name': 'company_name',
              'business_name': 'company_name',
              'corp_name': 'company_name',
              'llc_name': 'company_name',
              'name': 'company_name',
              'formation_date': 'registration_date',
              'file_date': 'registration_date',
              'date_filed': 'registration_date',
              'incorporation_date': 'registration_date',
              'principal_address': 'address_line1',
              'street_address': 'address_line1',
              'address': 'address_line1',
              'mailing_address': 'address_line1',
              'registered_agent_name': 'registered_agent',
              'agent_name': 'registered_agent',
              'ra_name': 'registered_agent',
              'entity_type': 'business_type',
              'type': 'business_type',
              'status': 'status'
            };
            
            return mappings[normalized] || normalized;
          }
        }));
      
      stream.on('data', (data) => {
        lineNumber++;
        
        try {
          // Parse and validate the record
          const record = this.parseFloridaRecord(data, cutoffDate);
          
          if (record) {
            results.push(record);
          }
          
        } catch (err) {
          errors.push({
            line: lineNumber,
            error: err.message,
            data: data
          });
        }
      });
      
      stream.on('end', () => {
        logger.info('Florida data parsing completed', { 
          totalLines: lineNumber,
          validRecords: results.length,
          errors: errors.length
        });
        
        resolve({
          records: results,
          errors: errors.slice(0, 100), // Limit error details
          totalProcessed: lineNumber
        });
      });
      
      stream.on('error', (err) => {
        logger.error('Error parsing Florida data', { error: err.message });
        reject(err);
      });
    });
  }

  // Parse individual Florida LLC record
  parseFloridaRecord(data, cutoffDate) {
    // Extract and validate company name
    const companyName = data.company_name || data.entity_name || data.business_name;
    if (!companyName || companyName.trim().length === 0) {
      throw new Error('Missing company name');
    }

    // Parse formation/registration date
    let registrationDate = null;
    const dateFields = [data.registration_date, data.formation_date, data.file_date, data.date_filed];
    
    for (const dateField of dateFields) {
      if (dateField) {
        const parsed = this.parseDate(dateField);
        if (parsed) {
          registrationDate = parsed;
          break;
        }
      }
    }

    // Filter by recent formation date
    if (!registrationDate || registrationDate < cutoffDate) {
      return null; // Skip old records
    }

    // Extract business type and filter for LLCs
    const businessType = (data.business_type || data.entity_type || data.type || '').toUpperCase();
    if (!businessType.includes('LLC') && !businessType.includes('LIMITED LIABILITY')) {
      return null; // Skip non-LLC entities
    }

    // Extract address information
    const address = this.parseAddress(data);

    // Extract registered agent
    const registeredAgent = data.registered_agent || data.agent_name || data.ra_name || null;

    // Extract officer information if available
    const officers = this.parseOfficers(data);

    return {
      company_name: companyName.trim(),
      state: 'FL',
      business_type: businessType,
      registration_date: registrationDate.toISOString().split('T')[0],
      status: (data.status || 'active').toLowerCase(),
      address_line1: address.line1,
      address_line2: address.line2,
      city: address.city,
      zip_code: address.zipCode,
      registered_agent: registeredAgent,
      officers: officers,
      source: 'florida_sftp',
      source_file: path.basename(this.currentFile || 'unknown'),
      raw_data: JSON.stringify(data) // Store original data for reference
    };
  }

  // Parse various date formats
  parseDate(dateString) {
    if (!dateString) return null;
    
    const dateFormats = [
      // Common formats
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, // MM/DD/YYYY or M/D/YYYY
      /^(\d{4})-(\d{1,2})-(\d{1,2})$/, // YYYY-MM-DD
      /^(\d{1,2})-(\d{1,2})-(\d{4})$/, // MM-DD-YYYY
      /^(\d{8})$/ // YYYYMMDD
    ];
    
    const str = dateString.toString().trim();
    
    // Try standard Date parsing first
    const standardDate = new Date(str);
    if (!isNaN(standardDate.getTime()) && standardDate.getFullYear() > 1900) {
      return standardDate;
    }
    
    // Try specific formats
    for (const format of dateFormats) {
      const match = str.match(format);
      if (match) {
        let year, month, day;
        
        if (str.length === 8) { // YYYYMMDD
          year = parseInt(str.substring(0, 4));
          month = parseInt(str.substring(4, 6)) - 1; // Month is 0-indexed
          day = parseInt(str.substring(6, 8));
        } else if (match[3] && match[3].length === 4) { // Year is in position 3
          month = parseInt(match[1]) - 1;
          day = parseInt(match[2]);
          year = parseInt(match[3]);
        } else { // Year is in position 1
          year = parseInt(match[1]);
          month = parseInt(match[2]) - 1;
          day = parseInt(match[3]);
        }
        
        const date = new Date(year, month, day);
        if (!isNaN(date.getTime()) && date.getFullYear() > 1900) {
          return date;
        }
      }
    }
    
    return null;
  }

  // Parse address from various fields
  parseAddress(data) {
    const address = {
      line1: null,
      line2: null,
      city: null,
      zipCode: null
    };

    // Try different address field combinations
    const addressFields = [
      data.address_line1, data.principal_address, data.street_address, 
      data.address, data.mailing_address
    ];
    
    for (const field of addressFields) {
      if (field && field.trim()) {
        address.line1 = field.trim();
        break;
      }
    }

    // Extract city
    const cityFields = [data.city, data.principal_city, data.mail_city];
    for (const field of cityFields) {
      if (field && field.trim()) {
        address.city = field.trim();
        break;
      }
    }

    // Extract ZIP code
    const zipFields = [data.zip_code, data.postal_code, data.zip, data.principal_zip];
    for (const field of zipFields) {
      if (field && field.toString().trim()) {
        const zip = field.toString().trim();
        // Validate ZIP format
        if (/^\d{5}(-\d{4})?$/.test(zip)) {
          address.zipCode = zip;
          break;
        }
      }
    }

    return address;
  }

  // Parse officer information from data
  parseOfficers(data) {
    const officers = [];
    
    // Look for officer fields (Florida often has officer1, officer2, etc.)
    for (let i = 1; i <= 10; i++) {
      const officerName = data[`officer${i}_name`] || data[`officer_${i}_name`];
      const officerTitle = data[`officer${i}_title`] || data[`officer_${i}_title`];
      
      if (officerName && officerName.trim()) {
        officers.push({
          name: officerName.trim(),
          title: officerTitle ? officerTitle.trim() : 'Officer'
        });
      }
    }
    
    // Also check for single officer fields
    const singleOfficer = data.officer_name || data.principal_name || data.manager_name;
    if (singleOfficer && singleOfficer.trim() && officers.length === 0) {
      officers.push({
        name: singleOfficer.trim(),
        title: 'Principal'
      });
    }
    
    return officers.length > 0 ? officers : null;
  }

  // Process downloaded Florida files
  async processFloridaFiles(daysBack = 7) {
    try {
      logger.info('Starting Florida file processing', { daysBack });
      
      // Get list of unprocessed files
      const files = await fs.readdir(this.downloadDir);
      const csvFiles = files.filter(f => f.endsWith('.csv') || f.endsWith('.txt'));
      
      if (csvFiles.length === 0) {
        logger.info('No CSV files found to process');
        return { processed: 0, newRecords: 0 };
      }
      
      let totalNewRecords = 0;
      let totalProcessed = 0;
      
      for (const fileName of csvFiles) {
        try {
          const filePath = path.join(this.downloadDir, fileName);
          this.currentFile = filePath;
          
          // Check if already processed
          const processedPath = path.join(this.processedDir, fileName);
          const alreadyProcessed = await fs.access(processedPath).then(() => true).catch(() => false);
          
          if (alreadyProcessed) {
            logger.info('File already processed, skipping', { fileName });
            continue;
          }
          
          logger.info('Processing Florida file', { fileName });
          
          // Parse the file
          const parseResult = await this.parseFloridaData(filePath, daysBack);
          
          if (parseResult.records.length > 0) {
            // Store records in database
            const storeResult = await this.storeFloridaRecords(parseResult.records, fileName);
            totalNewRecords += storeResult.newRecords;
          }
          
          totalProcessed++;
          
          // Mark file as processed
          await fs.copyFile(filePath, processedPath);
          
          logger.info('Florida file processed', { 
            fileName, 
            records: parseResult.records.length,
            newRecords: totalNewRecords 
          });
          
        } catch (err) {
          logger.error('Failed to process Florida file', { fileName, error: err.message });
        }
      }
      
      return { processed: totalProcessed, newRecords: totalNewRecords };
      
    } catch (err) {
      logger.error('Florida file processing failed', { error: err.message });
      throw err;
    }
  }

  // Store Florida records in database
  async storeFloridaRecords(records, sourceFile) {
    if (records.length === 0) {
      return { newRecords: 0, duplicates: 0, errors: 0 };
    }

    return await transaction(async (client) => {
      // Create import log
      const logResult = await client.query(`
        INSERT INTO import_logs (filename, source, total_records, status)
        VALUES ($1, $2, $3, 'processing')
        RETURNING id
      `, [sourceFile, 'florida_sftp', records.length]);
      
      const logId = logResult.rows[0].id;
      let newRecords = 0;
      let duplicates = 0;
      let errors = 0;

      try {
        for (const record of records) {
          try {
            // Generate deduplication hash
            const dedupHash = this.generateDedupHash(record.company_name, record.state);
            
            // Check for existing record
            const existingResult = await client.query(
              'SELECT id FROM leads WHERE dedup_hash = $1',
              [dedupHash]
            );

            if (existingResult.rows.length > 0) {
              duplicates++;
              continue;
            }

            // Insert new record
            const insertResult = await client.query(`
              INSERT INTO leads (
                company_name, state, business_type, registration_date, status,
                address_line1, address_line2, city, zip_code, registered_agent,
                source, source_file, dedup_hash, import_date
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP)
              RETURNING id
            `, [
              record.company_name, record.state, record.business_type, 
              record.registration_date, record.status, record.address_line1,
              record.address_line2, record.city, record.zip_code, 
              record.registered_agent, record.source, record.source_file, dedupHash
            ]);

            const leadId = insertResult.rows[0].id;

            // Store officer information if available
            if (record.officers && record.officers.length > 0) {
              for (const officer of record.officers) {
                await client.query(`
                  INSERT INTO lead_officers (lead_id, name, title)
                  VALUES ($1, $2, $3)
                `, [leadId, officer.name, officer.title]);
              }
            }

            newRecords++;

          } catch (err) {
            logger.error('Error inserting Florida record', { 
              company: record.company_name, 
              error: err.message 
            });
            errors++;
          }
        }

        // Update import log
        await client.query(`
          UPDATE import_logs 
          SET processed_records = $1, new_records = $2, duplicate_records = $3, 
              error_records = $4, status = 'completed', completed_at = CURRENT_TIMESTAMP
          WHERE id = $5
        `, [records.length, newRecords, duplicates, errors, logId]);

        logger.info('Florida records stored', { 
          newRecords, 
          duplicates, 
          errors, 
          sourceFile 
        });

        return { newRecords, duplicates, errors };

      } catch (err) {
        // Update import log with error
        await client.query(`
          UPDATE import_logs 
          SET status = 'failed', error_details = $1, completed_at = CURRENT_TIMESTAMP
          WHERE id = $2
        `, [JSON.stringify({ error: err.message }), logId]);
        
        throw err;
      }
    });
  }

  // Generate deduplication hash
  generateDedupHash(companyName, state) {
    const crypto = require('crypto');
    const normalizedName = companyName.toLowerCase().trim();
    const hashString = `${normalizedName}|${state.toUpperCase()}`;
    return crypto.createHash('sha256').update(hashString).digest('hex');
  }

  // Daily Florida data sync (main entry point)
  async dailySync(daysBack = 7) {
    try {
      logger.info('Starting daily Florida LLC sync', { daysBack });
      
      // Step 1: Download latest files
      const downloadResult = await this.downloadFiles();
      
      // Step 2: Process downloaded files
      const processResult = await this.processFloridaFiles(daysBack);
      
      logger.info('Daily Florida sync completed', {
        filesDownloaded: downloadResult.length,
        filesProcessed: processResult.processed,
        newRecords: processResult.newRecords
      });
      
      return {
        filesDownloaded: downloadResult.length,
        filesProcessed: processResult.processed,
        newRecords: processResult.newRecords,
        downloadedFiles: downloadResult
      };
      
    } catch (err) {
      logger.error('Daily Florida sync failed', { error: err.message });
      throw err;
    }
  }
}

module.exports = FloridaDataService;
