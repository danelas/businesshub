const { query, logger } = require('../database/connection');
const YelpEnrichmentService = require('./yelpEnrichmentService');
const GoogleSearchService = require('./googleSearchService');

class CombinedEnrichmentService {
  constructor() {
    this.yelpService = new YelpEnrichmentService();
    this.googleService = new GoogleSearchService();
    this.maxRetries = 2;
  }

  // Main enrichment function using both Yelp and Google
  async enrichLead(leadId) {
    try {
      // Get lead details
      const leadResult = await query('SELECT * FROM leads WHERE id = $1', [leadId]);
      if (leadResult.rows.length === 0) {
        throw new Error('Lead not found');
      }

      const lead = leadResult.rows[0];
      
      // Skip if already fully enriched
      if (lead.phone && lead.email && lead.website) {
        logger.info('Lead already fully enriched', { leadId, company: lead.company_name });
        return { success: true, message: 'Already fully enriched', lead };
      }

      logger.info('Starting combined enrichment', { 
        leadId, 
        company: lead.company_name, 
        city: lead.city 
      });

      const startTime = Date.now();
      const enrichmentData = {
        phone: lead.phone,
        email: lead.email,
        website: lead.website,
        sources: [],
        yelpData: null,
        googleData: null
      };

      // Step 1: Try Yelp first (usually better for phone numbers)
      if (!enrichmentData.phone) {
        try {
          logger.info('Trying Yelp enrichment', { leadId });
          const yelpResult = await this.yelpService.enrichLead(leadId);
          
          if (yelpResult.success && yelpResult.yelpData) {
            enrichmentData.yelpData = yelpResult.yelpData;
            if (yelpResult.yelpData.phone) {
              enrichmentData.phone = yelpResult.yelpData.phone;
              enrichmentData.sources.push({
                source: 'yelp',
                type: 'phone',
                confidence: 'high',
                data: {
                  rating: yelpResult.yelpData.rating,
                  reviewCount: yelpResult.yelpData.reviewCount
                }
              });
            }
            if (yelpResult.yelpData.yelpUrl && !enrichmentData.website) {
              enrichmentData.website = yelpResult.yelpData.yelpUrl;
              enrichmentData.sources.push({
                source: 'yelp',
                type: 'website',
                confidence: 'high'
              });
            }
          }
        } catch (yelpErr) {
          logger.warn('Yelp enrichment failed', { leadId, error: yelpErr.message });
        }
      }

      // Step 2: Try Google Search (better for emails and websites)
      if (!enrichmentData.phone || !enrichmentData.email || !enrichmentData.website) {
        try {
          logger.info('Trying Google search enrichment', { leadId });
          const googleResult = await this.googleService.searchBusiness(
            lead.company_name, 
            lead.city, 
            lead.state
          );
          
          if (googleResult) {
            enrichmentData.googleData = googleResult;
            
            // Use Google phone if Yelp didn't find one
            if (googleResult.phone && !enrichmentData.phone) {
              enrichmentData.phone = googleResult.phone;
              enrichmentData.sources.push({
                source: 'google_search',
                type: 'phone',
                confidence: 'medium'
              });
            }
            
            // Use Google email (Yelp doesn't provide emails)
            if (googleResult.email && !enrichmentData.email) {
              enrichmentData.email = googleResult.email;
              enrichmentData.sources.push({
                source: 'google_search',
                type: 'email',
                confidence: 'medium'
              });
            }
            
            // Use Google website if better than Yelp page
            if (googleResult.website && !enrichmentData.website) {
              enrichmentData.website = googleResult.website;
              enrichmentData.sources.push({
                source: 'google_search',
                type: 'website',
                confidence: 'medium'
              });
            }
          }
        } catch (googleErr) {
          logger.warn('Google search enrichment failed', { leadId, error: googleErr.message });
        }
      }

      // Step 3: Update lead with combined results
      const processingTime = Date.now() - startTime;
      const hasNewData = enrichmentData.phone !== lead.phone || 
                        enrichmentData.email !== lead.email || 
                        enrichmentData.website !== lead.website;

      if (hasNewData) {
        const updatedLead = await this.updateLeadWithEnrichmentData(leadId, enrichmentData);
        await this.logCombinedEnrichment(leadId, true, enrichmentData, processingTime);
        
        logger.info('Combined enrichment successful', { 
          leadId, 
          company: lead.company_name,
          phone: enrichmentData.phone ? 'found' : 'not found',
          email: enrichmentData.email ? 'found' : 'not found',
          website: enrichmentData.website ? 'found' : 'not found',
          sources: enrichmentData.sources.map(s => s.source)
        });

        return { 
          success: true, 
          message: 'Enriched with combined data', 
          lead: updatedLead, 
          enrichmentData,
          processingTime 
        };
      } else {
        await this.logCombinedEnrichment(leadId, false, enrichmentData, processingTime, 'No new data found');
        return { 
          success: false, 
          message: 'No new contact information found', 
          lead,
          enrichmentData,
          processingTime 
        };
      }

    } catch (err) {
      logger.error('Combined enrichment failed', { leadId, error: err.message });
      await this.logCombinedEnrichment(leadId, false, null, 0, err.message);
      return { success: false, error: err.message };
    }
  }

  // Update lead with combined enrichment data
  async updateLeadWithEnrichmentData(leadId, enrichmentData) {
    const updateQuery = `
      UPDATE leads 
      SET phone = COALESCE($1, phone),
          email = COALESCE($2, email),
          website = COALESCE($3, website),
          enrichment_status = 'completed',
          last_enrichment_attempt = CURRENT_TIMESTAMP,
          contact_sources = $4::jsonb,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $5
      RETURNING *
    `;

    const result = await query(updateQuery, [
      enrichmentData.phone,
      enrichmentData.email,
      enrichmentData.website,
      JSON.stringify(enrichmentData.sources),
      leadId
    ]);

    return result.rows[0];
  }

  // Log combined enrichment attempt
  async logCombinedEnrichment(leadId, success, enrichmentData, processingTime, errorMessage = null) {
    try {
      const phonesFound = enrichmentData && enrichmentData.phone ? 1 : 0;
      const emailsFound = enrichmentData && enrichmentData.email ? 1 : 0;
      const websiteFound = enrichmentData && enrichmentData.website ? 1 : 0;
      
      const sources = enrichmentData ? 
        [...new Set(enrichmentData.sources.map(s => s.source))] : 
        [];

      await query(`
        INSERT INTO contact_enrichment_log 
        (lead_id, phones_found, emails_found, website_found, sources, success, error_message, processing_time_ms)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        leadId,
        phonesFound,
        emailsFound,
        websiteFound,
        JSON.stringify(sources),
        success,
        errorMessage,
        processingTime
      ]);
    } catch (err) {
      logger.error('Failed to log combined enrichment', { leadId, error: err.message });
    }
  }

  // Bulk enrichment with both services
  async enrichMultipleLeads(leadIds, options = {}) {
    const { 
      batchSize = 3, 
      delayBetweenBatches = 3000, // 3 seconds to respect both APIs
      maxConcurrent = 2 
    } = options;
    
    const results = [];

    logger.info('Starting bulk combined enrichment', { leadCount: leadIds.length });

    // Process in smaller batches to respect API limits
    for (let i = 0; i < leadIds.length; i += batchSize) {
      const batch = leadIds.slice(i, i + batchSize);
      const batchResults = [];

      // Process batch with limited concurrency
      const promises = batch.map(leadId => this.enrichLead(leadId));
      const batchResponses = await Promise.allSettled(promises);

      batchResponses.forEach((response, index) => {
        const leadId = batch[index];
        if (response.status === 'fulfilled') {
          batchResults.push(response.value);
        } else {
          batchResults.push({
            success: false,
            leadId,
            error: response.reason.message
          });
        }
      });

      results.push(...batchResults);

      // Delay between batches
      if (i + batchSize < leadIds.length) {
        logger.info(`Processed batch ${Math.floor(i/batchSize) + 1}, waiting before next batch...`);
        await this.delay(delayBetweenBatches);
      }
    }

    const successCount = results.filter(r => r.success).length;
    const phoneCount = results.filter(r => r.success && r.enrichmentData && r.enrichmentData.phone).length;
    const emailCount = results.filter(r => r.success && r.enrichmentData && r.enrichmentData.email).length;

    logger.info('Bulk combined enrichment completed', { 
      total: leadIds.length, 
      success: successCount,
      failed: leadIds.length - successCount,
      phonesFound: phoneCount,
      emailsFound: emailCount
    });

    return {
      total: leadIds.length,
      success: successCount,
      failed: leadIds.length - successCount,
      phonesFound: phoneCount,
      emailsFound: emailCount,
      results
    };
  }

  // Get enrichment statistics
  async getEnrichmentStats(days = 30) {
    const result = await query(`
      SELECT 
        DATE_TRUNC('day', enrichment_date) as date,
        COUNT(*) as total_attempts,
        COUNT(CASE WHEN success = true THEN 1 END) as successful,
        COUNT(CASE WHEN phones_found > 0 THEN 1 END) as phones_found,
        COUNT(CASE WHEN emails_found > 0 THEN 1 END) as emails_found,
        COUNT(CASE WHEN website_found = true THEN 1 END) as websites_found,
        AVG(processing_time_ms) as avg_processing_time,
        COUNT(CASE WHEN sources @> '["yelp"]' THEN 1 END) as yelp_successes,
        COUNT(CASE WHEN sources @> '["google_search"]' THEN 1 END) as google_successes
      FROM contact_enrichment_log 
      WHERE enrichment_date >= CURRENT_DATE - INTERVAL '${days} days'
      GROUP BY DATE_TRUNC('day', enrichment_date)
      ORDER BY date DESC
    `);

    return result.rows;
  }

  // Utility function for delays
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = CombinedEnrichmentService;
