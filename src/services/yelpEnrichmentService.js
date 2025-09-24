const axios = require('axios');
const { query, logger } = require('../database/connection');

class YelpEnrichmentService {
  constructor() {
    this.apiKey = process.env.YELP_API_KEY;
    this.baseUrl = 'https://api.yelp.com/v3/businesses/search';
    this.maxRetries = 3;
    this.retryDelay = 1000; // 1 second
  }

  // Main enrichment function
  async enrichLead(leadId) {
    try {
      // Get lead details
      const leadResult = await query('SELECT * FROM leads WHERE id = $1', [leadId]);
      if (leadResult.rows.length === 0) {
        throw new Error('Lead not found');
      }

      const lead = leadResult.rows[0];
      
      // Skip if already has contact info
      if (lead.phone && lead.email) {
        logger.info('Lead already has contact info', { leadId, company: lead.company_name });
        return { success: true, message: 'Already enriched', lead };
      }

      logger.info('Starting Yelp enrichment', { 
        leadId, 
        company: lead.company_name, 
        city: lead.city 
      });

      // Search Yelp for the business
      const yelpData = await this.searchYelp(lead.company_name, lead.city, lead.state);
      
      if (!yelpData) {
        await this.logEnrichmentAttempt(leadId, false, 'No Yelp match found');
        return { success: false, message: 'No Yelp match found', lead };
      }

      // Update lead with Yelp data
      const updatedLead = await this.updateLeadWithYelpData(leadId, yelpData);
      
      // Log successful enrichment
      await this.logEnrichmentAttempt(leadId, true, 'Yelp match found', yelpData);

      logger.info('Yelp enrichment successful', { 
        leadId, 
        company: lead.company_name,
        phone: yelpData.phone,
        rating: yelpData.rating 
      });

      return { success: true, message: 'Enriched with Yelp data', lead: updatedLead, yelpData };

    } catch (err) {
      logger.error('Yelp enrichment failed', { leadId, error: err.message });
      await this.logEnrichmentAttempt(leadId, false, err.message);
      return { success: false, error: err.message };
    }
  }

  // Search Yelp for business
  async searchYelp(companyName, city, state, attempt = 1) {
    try {
      if (!this.apiKey) {
        throw new Error('Yelp API key not configured');
      }

      // Clean company name for search
      const searchTerm = this.cleanCompanyName(companyName);
      const location = `${city}, ${state}`;

      const params = {
        term: searchTerm,
        location: location,
        limit: 10, // Get multiple results to find best match
        sort_by: 'best_match'
      };

      logger.info('Searching Yelp', { searchTerm, location });

      const response = await axios.get(this.baseUrl, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json'
        },
        params: params,
        timeout: 10000 // 10 second timeout
      });

      if (!response.data || !response.data.businesses) {
        throw new Error('Invalid Yelp API response');
      }

      // Find best match
      const bestMatch = this.findBestMatch(companyName, response.data.businesses);
      
      if (bestMatch) {
        return this.formatYelpData(bestMatch);
      }

      return null;

    } catch (err) {
      if (attempt < this.maxRetries && this.isRetryableError(err)) {
        logger.warn(`Yelp search attempt ${attempt} failed, retrying...`, { error: err.message });
        await this.delay(this.retryDelay * attempt);
        return this.searchYelp(companyName, city, state, attempt + 1);
      }

      // Handle specific Yelp API errors
      if (err.response) {
        const status = err.response.status;
        if (status === 401) {
          throw new Error('Yelp API key invalid or expired');
        } else if (status === 429) {
          throw new Error('Yelp API rate limit exceeded');
        } else if (status === 400) {
          throw new Error('Invalid search parameters for Yelp API');
        }
      }

      throw new Error(`Yelp search failed: ${err.message}`);
    }
  }

  // Clean company name for better search results
  cleanCompanyName(companyName) {
    return companyName
      .replace(/\s+(LLC|Inc|Corp|Corporation|Company|Co\.?)$/i, '') // Remove business suffixes
      .replace(/[^\w\s&-]/g, '') // Remove special characters except &, -, spaces
      .trim();
  }

  // Find best matching business from Yelp results
  findBestMatch(originalName, businesses) {
    if (!businesses || businesses.length === 0) {
      return null;
    }

    const cleanOriginal = this.cleanCompanyName(originalName).toLowerCase();
    
    // Score each business
    const scoredBusinesses = businesses.map(business => {
      const cleanYelpName = this.cleanCompanyName(business.name).toLowerCase();
      const similarity = this.calculateSimilarity(cleanOriginal, cleanYelpName);
      
      return {
        business,
        similarity,
        hasPhone: !!business.phone,
        reviewCount: business.review_count || 0,
        rating: business.rating || 0
      };
    });

    // Sort by similarity, then by having phone, then by review count
    scoredBusinesses.sort((a, b) => {
      if (Math.abs(a.similarity - b.similarity) > 0.1) {
        return b.similarity - a.similarity; // Higher similarity first
      }
      if (a.hasPhone !== b.hasPhone) {
        return b.hasPhone - a.hasPhone; // Has phone first
      }
      return b.reviewCount - a.reviewCount; // More reviews first
    });

    // Return best match if similarity is good enough
    const bestMatch = scoredBusinesses[0];
    if (bestMatch && bestMatch.similarity > 0.6) { // 60% similarity threshold
      logger.info('Yelp match found', {
        original: originalName,
        matched: bestMatch.business.name,
        similarity: bestMatch.similarity,
        hasPhone: bestMatch.hasPhone,
        rating: bestMatch.rating
      });
      return bestMatch.business;
    }

    return null;
  }

  // Calculate string similarity (simple algorithm)
  calculateSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) {
      return 1.0;
    }

    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  // Levenshtein distance for string similarity
  levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  // Format Yelp data for our system
  formatYelpData(yelpBusiness) {
    return {
      name: yelpBusiness.name,
      phone: yelpBusiness.phone || yelpBusiness.display_phone,
      website: yelpBusiness.url, // Yelp business page URL
      address: yelpBusiness.location ? {
        address1: yelpBusiness.location.address1,
        city: yelpBusiness.location.city,
        state: yelpBusiness.location.state,
        zip: yelpBusiness.location.zip_code
      } : null,
      rating: yelpBusiness.rating,
      reviewCount: yelpBusiness.review_count,
      categories: yelpBusiness.categories ? yelpBusiness.categories.map(cat => cat.title) : [],
      yelpId: yelpBusiness.id,
      yelpUrl: yelpBusiness.url,
      isOpen: yelpBusiness.is_closed === false,
      priceLevel: yelpBusiness.price
    };
  }

  // Update lead with Yelp data
  async updateLeadWithYelpData(leadId, yelpData) {
    const updateQuery = `
      UPDATE leads 
      SET phone = COALESCE(phone, $1),
          website = COALESCE(website, $2),
          enrichment_status = 'completed',
          last_enrichment_attempt = CURRENT_TIMESTAMP,
          contact_sources = COALESCE(contact_sources, '[]'::jsonb) || $3::jsonb,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      RETURNING *
    `;

    const contactSources = JSON.stringify([{
      source: 'yelp',
      confidence: 'high',
      data: {
        rating: yelpData.rating,
        reviewCount: yelpData.reviewCount,
        yelpId: yelpData.yelpId
      }
    }]);

    const result = await query(updateQuery, [
      yelpData.phone,
      yelpData.yelpUrl,
      contactSources,
      leadId
    ]);

    return result.rows[0];
  }

  // Log enrichment attempt
  async logEnrichmentAttempt(leadId, success, message, yelpData = null) {
    try {
      await query(`
        INSERT INTO contact_enrichment_log 
        (lead_id, phones_found, emails_found, website_found, sources, success, error_message, processing_time_ms)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        leadId,
        yelpData && yelpData.phone ? 1 : 0,
        0, // Yelp doesn't provide emails
        yelpData && yelpData.yelpUrl ? 1 : 0,
        JSON.stringify(['yelp']),
        success,
        success ? null : message,
        1500 // Approximate processing time
      ]);
    } catch (err) {
      logger.error('Failed to log enrichment attempt', { leadId, error: err.message });
    }
  }

  // Bulk enrichment for multiple leads
  async enrichMultipleLeads(leadIds, options = {}) {
    const { batchSize = 5, delayBetweenBatches = 2000 } = options;
    const results = [];

    logger.info('Starting bulk Yelp enrichment', { leadCount: leadIds.length });

    // Process in batches to respect rate limits
    for (let i = 0; i < leadIds.length; i += batchSize) {
      const batch = leadIds.slice(i, i + batchSize);
      const batchResults = [];

      // Process batch concurrently
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

      // Delay between batches to respect rate limits
      if (i + batchSize < leadIds.length) {
        await this.delay(delayBetweenBatches);
      }
    }

    const successCount = results.filter(r => r.success).length;
    logger.info('Bulk Yelp enrichment completed', { 
      total: leadIds.length, 
      success: successCount,
      failed: leadIds.length - successCount
    });

    return {
      total: leadIds.length,
      success: successCount,
      failed: leadIds.length - successCount,
      results
    };
  }

  // Check if error is retryable
  isRetryableError(err) {
    if (!err.response) return true; // Network errors are retryable
    
    const status = err.response.status;
    // Retry on server errors and rate limits, but not on client errors
    return status >= 500 || status === 429;
  }

  // Utility function for delays
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Get enrichment statistics
  async getEnrichmentStats(days = 30) {
    const result = await query(`
      SELECT 
        COUNT(*) as total_attempts,
        COUNT(CASE WHEN success = true THEN 1 END) as successful,
        COUNT(CASE WHEN phones_found > 0 THEN 1 END) as phones_found,
        AVG(processing_time_ms) as avg_processing_time,
        DATE_TRUNC('day', enrichment_date) as date
      FROM contact_enrichment_log 
      WHERE enrichment_date >= CURRENT_DATE - INTERVAL '${days} days'
        AND sources @> '["yelp"]'
      GROUP BY DATE_TRUNC('day', enrichment_date)
      ORDER BY date DESC
    `);

    return result.rows;
  }
}

module.exports = YelpEnrichmentService;
