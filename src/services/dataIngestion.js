const fs = require('fs');
const csv = require('csv-parser');
const crypto = require('crypto');
const axios = require('axios');
const { query, transaction, logger } = require('../database/connection');

class DataIngestionService {
  constructor() {
    this.batchSize = 1000;
    this.supportedStates = [
      'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
      'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
      'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
      'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
      'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
    ];
  }

  // Generate deduplication hash
  generateDedupHash(lead) {
    const normalizedName = lead.company_name.toLowerCase().trim();
    const state = lead.state.toUpperCase();
    const hashString = `${normalizedName}|${state}`;
    return crypto.createHash('sha256').update(hashString).digest('hex');
  }

  // Validate and clean lead data
  validateLead(rawLead) {
    const errors = [];
    const lead = {};

    // Required fields
    if (!rawLead.company_name || rawLead.company_name.trim().length === 0) {
      errors.push('Company name is required');
    } else {
      lead.company_name = rawLead.company_name.trim();
    }

    if (!rawLead.state || !this.supportedStates.includes(rawLead.state.toUpperCase())) {
      errors.push('Valid state code is required');
    } else {
      lead.state = rawLead.state.toUpperCase();
    }

    // Optional fields with validation
    if (rawLead.business_type) {
      lead.business_type = rawLead.business_type.trim();
    }

    if (rawLead.registration_date) {
      const date = new Date(rawLead.registration_date);
      if (!isNaN(date.getTime())) {
        lead.registration_date = date.toISOString().split('T')[0];
      }
    }

    // Address fields
    ['address_line1', 'address_line2', 'city', 'zip_code'].forEach(field => {
      if (rawLead[field]) {
        lead[field] = rawLead[field].trim();
      }
    });

    // Contact fields
    if (rawLead.phone) {
      // Basic phone number cleaning
      const cleanPhone = rawLead.phone.replace(/[^\d+]/g, '');
      if (cleanPhone.length >= 10) {
        lead.phone = cleanPhone;
      }
    }

    if (rawLead.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (emailRegex.test(rawLead.email.trim())) {
        lead.email = rawLead.email.trim().toLowerCase();
      }
    }

    // Other fields
    ['website', 'ein', 'registered_agent', 'industry'].forEach(field => {
      if (rawLead[field]) {
        lead[field] = rawLead[field].trim();
      }
    });

    // Numeric fields
    if (rawLead.employee_count_estimate) {
      const count = parseInt(rawLead.employee_count_estimate);
      if (!isNaN(count) && count >= 0) {
        lead.employee_count_estimate = count;
      }
    }

    if (rawLead.revenue_estimate) {
      const revenue = parseFloat(rawLead.revenue_estimate);
      if (!isNaN(revenue) && revenue >= 0) {
        lead.revenue_estimate = revenue;
      }
    }

    return { lead, errors };
  }

  // Import from CSV file
  async importFromCSV(filePath, source = 'csv_import') {
    return new Promise((resolve, reject) => {
      const results = [];
      const errors = [];
      let lineNumber = 0;

      logger.info('Starting CSV import', { filePath, source });

      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => {
          lineNumber++;
          const { lead, errors: validationErrors } = this.validateLead(data);
          
          if (validationErrors.length > 0) {
            errors.push({ line: lineNumber, errors: validationErrors, data });
          } else {
            lead.source = source;
            lead.source_file = filePath.split('/').pop();
            lead.dedup_hash = this.generateDedupHash(lead);
            results.push(lead);
          }
        })
        .on('end', async () => {
          try {
            const importResult = await this.bulkInsertLeads(results, source, filePath);
            resolve({
              ...importResult,
              validationErrors: errors,
              totalProcessed: lineNumber
            });
          } catch (err) {
            reject(err);
          }
        })
        .on('error', reject);
    });
  }

  // Import from API endpoint
  async importFromAPI(apiUrl, apiKey, stateCode, source = 'api_import') {
    try {
      logger.info('Starting API import', { apiUrl, stateCode, source });

      const headers = {};
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const response = await axios.get(apiUrl, { headers });
      const rawData = Array.isArray(response.data) ? response.data : response.data.results || [];

      const validLeads = [];
      const errors = [];

      for (let i = 0; i < rawData.length; i++) {
        const { lead, errors: validationErrors } = this.validateLead(rawData[i]);
        
        if (validationErrors.length > 0) {
          errors.push({ index: i, errors: validationErrors, data: rawData[i] });
        } else {
          lead.source = source;
          lead.source_file = `api_${stateCode}_${new Date().toISOString().split('T')[0]}`;
          lead.dedup_hash = this.generateDedupHash(lead);
          validLeads.push(lead);
        }
      }

      const importResult = await this.bulkInsertLeads(validLeads, source, lead.source_file);
      
      return {
        ...importResult,
        validationErrors: errors,
        totalProcessed: rawData.length
      };

    } catch (err) {
      logger.error('API import failed', { error: err.message, apiUrl });
      throw err;
    }
  }

  // Bulk insert leads with deduplication
  async bulkInsertLeads(leads, source, sourceFile) {
    if (leads.length === 0) {
      return { newRecords: 0, duplicateRecords: 0, errorRecords: 0 };
    }

    return await transaction(async (client) => {
      // Create import log
      const logResult = await client.query(`
        INSERT INTO import_logs (filename, source, total_records, status)
        VALUES ($1, $2, $3, 'processing')
        RETURNING id
      `, [sourceFile, source, leads.length]);
      
      const logId = logResult.rows[0].id;
      let newRecords = 0;
      let duplicateRecords = 0;
      let errorRecords = 0;

      try {
        // Process in batches
        for (let i = 0; i < leads.length; i += this.batchSize) {
          const batch = leads.slice(i, i + this.batchSize);
          
          for (const lead of batch) {
            try {
              // Check for existing lead with same dedup hash
              const existingResult = await client.query(
                'SELECT id FROM leads WHERE dedup_hash = $1',
                [lead.dedup_hash]
              );

              if (existingResult.rows.length > 0) {
                duplicateRecords++;
                continue;
              }

              // Insert new lead
              const insertQuery = `
                INSERT INTO leads (
                  company_name, state, business_type, registration_date, status,
                  address_line1, address_line2, city, zip_code, phone, email, website,
                  ein, registered_agent, industry, employee_count_estimate, revenue_estimate,
                  source, source_file, dedup_hash
                ) VALUES (
                  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
                )
              `;

              const values = [
                lead.company_name, lead.state, lead.business_type, lead.registration_date, 'active',
                lead.address_line1, lead.address_line2, lead.city, lead.zip_code,
                lead.phone, lead.email, lead.website, lead.ein, lead.registered_agent,
                lead.industry, lead.employee_count_estimate, lead.revenue_estimate,
                lead.source, lead.source_file, lead.dedup_hash
              ];

              await client.query(insertQuery, values);
              newRecords++;

            } catch (err) {
              logger.error('Error inserting lead', { lead: lead.company_name, error: err.message });
              errorRecords++;
            }
          }
        }

        // Update import log
        await client.query(`
          UPDATE import_logs 
          SET processed_records = $1, new_records = $2, duplicate_records = $3, 
              error_records = $4, status = 'completed', completed_at = CURRENT_TIMESTAMP
          WHERE id = $5
        `, [leads.length, newRecords, duplicateRecords, errorRecords, logId]);

        logger.info('Bulk insert completed', { 
          newRecords, 
          duplicateRecords, 
          errorRecords, 
          source, 
          sourceFile 
        });

        return { newRecords, duplicateRecords, errorRecords };

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

  // Get import statistics
  async getImportStats(days = 30) {
    const result = await query(`
      SELECT 
        source,
        COUNT(*) as import_count,
        SUM(total_records) as total_records,
        SUM(new_records) as new_records,
        SUM(duplicate_records) as duplicate_records,
        SUM(error_records) as error_records,
        MAX(completed_at) as last_import
      FROM import_logs 
      WHERE completed_at >= CURRENT_DATE - INTERVAL '${days} days'
      GROUP BY source
      ORDER BY last_import DESC
    `);

    return result.rows;
  }

  // State-specific API configurations (examples)
  getStateAPIConfig(stateCode) {
    const configs = {
      'CA': {
        url: 'https://bizfileonline.sos.ca.gov/api/records/businesssearch',
        requiresKey: false,
        rateLimit: 100 // requests per hour
      },
      'TX': {
        url: 'https://mycpa.cpa.state.tx.us/coa/servlet/cpa.app.coa.CoaGetTp',
        requiresKey: true,
        rateLimit: 50
      },
      'NY': {
        url: 'https://appext20.dos.ny.gov/corp_public/CORPSEARCH.ENTITY_SEARCH_ENTRY',
        requiresKey: false,
        rateLimit: 25
      }
      // Add more state configurations as needed
    };

    return configs[stateCode.toUpperCase()] || null;
  }
}

module.exports = DataIngestionService;
