const axios = require('axios');
const cheerio = require('cheerio');
const { query, logger } = require('../database/connection');

class ContactEnrichmentService {
  constructor() {
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
    this.requestDelay = 2000; // 2 seconds between requests to be respectful
    this.maxRetries = 3;
    
    // Phone number regex patterns
    this.phonePatterns = [
      /(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/g, // (123) 456-7890, 123-456-7890, 123.456.7890
      /(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/g,      // 123 456 7890
      /(\+1[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/g // +1 (123) 456-7890
    ];
    
    // Email regex pattern
    this.emailPattern = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  }

  // Main enrichment function for a lead
  async enrichLead(leadId) {
    try {
      // Get lead information
      const leadResult = await query('SELECT * FROM leads WHERE id = $1', [leadId]);
      if (leadResult.rows.length === 0) {
        throw new Error('Lead not found');
      }

      const lead = leadResult.rows[0];
      
      logger.info('Starting contact enrichment', { 
        leadId, 
        companyName: lead.company_name,
        city: lead.city 
      });

      const enrichmentData = {
        leadId,
        companyName: lead.company_name,
        city: lead.city || '',
        state: lead.state,
        foundContacts: {
          phones: [],
          emails: [],
          website: null
        },
        sources: []
      };

      // Step 1: Google Search for website and contact info
      const googleResults = await this.searchGoogle(lead.company_name, lead.city);
      if (googleResults.website) {
        enrichmentData.foundContacts.website = googleResults.website;
        enrichmentData.sources.push('google_search');
        
        // Scrape the website for contact info
        const websiteContacts = await this.scrapeWebsiteContacts(googleResults.website);
        enrichmentData.foundContacts.phones.push(...websiteContacts.phones);
        enrichmentData.foundContacts.emails.push(...websiteContacts.emails);
        if (websiteContacts.found) {
          enrichmentData.sources.push('company_website');
        }
      }

      // Step 2: Search business directories
      const directoryResults = await this.searchBusinessDirectories(lead.company_name, lead.city);
      enrichmentData.foundContacts.phones.push(...directoryResults.phones);
      enrichmentData.foundContacts.emails.push(...directoryResults.emails);
      enrichmentData.sources.push(...directoryResults.sources);

      // Step 3: Clean and deduplicate contacts
      enrichmentData.foundContacts.phones = this.cleanPhoneNumbers(enrichmentData.foundContacts.phones);
      enrichmentData.foundContacts.emails = this.cleanEmails(enrichmentData.foundContacts.emails);

      // Step 4: Update lead in database
      await this.updateLeadContacts(leadId, enrichmentData.foundContacts);

      // Step 5: Log enrichment attempt
      await this.logEnrichmentAttempt(leadId, enrichmentData);

      logger.info('Contact enrichment completed', {
        leadId,
        phonesFound: enrichmentData.foundContacts.phones.length,
        emailsFound: enrichmentData.foundContacts.emails.length,
        website: enrichmentData.foundContacts.website,
        sources: enrichmentData.sources
      });

      return enrichmentData;

    } catch (err) {
      logger.error('Contact enrichment failed', { leadId, error: err.message });
      throw err;
    }
  }

  // Search Google for company website and contact info
  async searchGoogle(companyName, city = '') {
    try {
      const searchQuery = city 
        ? `"${companyName}" ${city} contact phone`
        : `"${companyName}" contact phone`;
      
      const encodedQuery = encodeURIComponent(searchQuery);
      const googleUrl = `https://www.google.com/search?q=${encodedQuery}`;
      
      logger.debug('Searching Google', { query: searchQuery });
      
      const response = await this.makeRequest(googleUrl, {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive',
        }
      });

      const $ = cheerio.load(response.data);
      
      // Extract website from search results
      let website = null;
      const searchResults = $('div.g');
      
      searchResults.each((i, element) => {
        if (i < 3) { // Check first 3 results
          const link = $(element).find('a[href]').first().attr('href');
          if (link && this.isValidBusinessWebsite(link, companyName)) {
            website = link;
            return false; // Break loop
          }
        }
      });

      // Look for phone numbers in search results
      const phones = [];
      const pageText = $.text();
      this.phonePatterns.forEach(pattern => {
        const matches = pageText.match(pattern);
        if (matches) {
          phones.push(...matches);
        }
      });

      await this.delay(this.requestDelay);

      return {
        website,
        phones: this.cleanPhoneNumbers(phones),
        source: 'google_search'
      };

    } catch (err) {
      logger.error('Google search failed', { companyName, error: err.message });
      return { website: null, phones: [], source: 'google_search' };
    }
  }

  // Scrape website for contact information
  async scrapeWebsiteContacts(websiteUrl) {
    try {
      logger.debug('Scraping website for contacts', { websiteUrl });
      
      const contacts = { phones: [], emails: [], found: false };
      
      // Try common contact pages
      const pagesToTry = [
        websiteUrl,
        `${websiteUrl}/contact`,
        `${websiteUrl}/contact-us`,
        `${websiteUrl}/about`,
        `${websiteUrl}/about-us`
      ];

      for (const pageUrl of pagesToTry) {
        try {
          const response = await this.makeRequest(pageUrl, {
            headers: { 'User-Agent': this.userAgent },
            timeout: 10000
          });

          const $ = cheerio.load(response.data);
          const pageText = $.text();

          // Extract phone numbers
          this.phonePatterns.forEach(pattern => {
            const matches = pageText.match(pattern);
            if (matches) {
              contacts.phones.push(...matches);
              contacts.found = true;
            }
          });

          // Extract emails
          const emailMatches = pageText.match(this.emailPattern);
          if (emailMatches) {
            contacts.emails.push(...emailMatches);
            contacts.found = true;
          }

          // If we found contacts, no need to check other pages
          if (contacts.found) {
            break;
          }

          await this.delay(this.requestDelay);

        } catch (err) {
          logger.debug('Failed to scrape page', { pageUrl, error: err.message });
          continue;
        }
      }

      return contacts;

    } catch (err) {
      logger.error('Website scraping failed', { websiteUrl, error: err.message });
      return { phones: [], emails: [], found: false };
    }
  }

  // Search business directories for contact info
  async searchBusinessDirectories(companyName, city = '') {
    const allContacts = { phones: [], emails: [], sources: [] };

    // Search multiple directories
    const directories = [
      { name: 'yelp', method: this.searchYelp.bind(this) },
      { name: 'yellowpages', method: this.searchYellowPages.bind(this) },
      { name: 'bbb', method: this.searchBBB.bind(this) },
      { name: 'manta', method: this.searchManta.bind(this) }
    ];

    for (const directory of directories) {
      try {
        logger.debug('Searching directory', { directory: directory.name, companyName });
        
        const results = await directory.method(companyName, city);
        
        if (results.phones.length > 0 || results.emails.length > 0) {
          allContacts.phones.push(...results.phones);
          allContacts.emails.push(...results.emails);
          allContacts.sources.push(directory.name);
        }

        await this.delay(this.requestDelay);

      } catch (err) {
        logger.error('Directory search failed', { 
          directory: directory.name, 
          companyName, 
          error: err.message 
        });
      }
    }

    return allContacts;
  }

  // Search Yelp for business contact info
  async searchYelp(companyName, city = '') {
    try {
      const searchQuery = city 
        ? `${companyName} ${city}`
        : companyName;
      
      const encodedQuery = encodeURIComponent(searchQuery);
      const yelpUrl = `https://www.yelp.com/search?find_desc=${encodedQuery}`;
      
      const response = await this.makeRequest(yelpUrl, {
        headers: { 'User-Agent': this.userAgent }
      });

      const $ = cheerio.load(response.data);
      const phones = [];
      const emails = [];

      // Look for phone numbers in Yelp listings
      $('.biz-phone').each((i, element) => {
        const phone = $(element).text().trim();
        if (phone) phones.push(phone);
      });

      // Extract from page text as fallback
      const pageText = $.text();
      this.phonePatterns.forEach(pattern => {
        const matches = pageText.match(pattern);
        if (matches) phones.push(...matches);
      });

      return { phones, emails, source: 'yelp' };

    } catch (err) {
      logger.error('Yelp search failed', { companyName, error: err.message });
      return { phones: [], emails: [], source: 'yelp' };
    }
  }

  // Search Yellow Pages
  async searchYellowPages(companyName, city = '') {
    try {
      const searchQuery = city 
        ? `${companyName} ${city}`
        : companyName;
      
      const encodedQuery = encodeURIComponent(searchQuery);
      const ypUrl = `https://www.yellowpages.com/search?search_terms=${encodedQuery}`;
      
      const response = await this.makeRequest(ypUrl, {
        headers: { 'User-Agent': this.userAgent }
      });

      const $ = cheerio.load(response.data);
      const phones = [];
      const emails = [];

      // Extract phone numbers from Yellow Pages
      $('.phones').each((i, element) => {
        const phone = $(element).text().trim();
        if (phone) phones.push(phone);
      });

      $('.phone').each((i, element) => {
        const phone = $(element).text().trim();
        if (phone) phones.push(phone);
      });

      return { phones, emails, source: 'yellowpages' };

    } catch (err) {
      logger.error('Yellow Pages search failed', { companyName, error: err.message });
      return { phones: [], emails: [], source: 'yellowpages' };
    }
  }

  // Search Better Business Bureau
  async searchBBB(companyName, city = '') {
    try {
      const searchQuery = city 
        ? `${companyName} ${city}`
        : companyName;
      
      const encodedQuery = encodeURIComponent(searchQuery);
      const bbbUrl = `https://www.bbb.org/search?find_country=USA&find_text=${encodedQuery}`;
      
      const response = await this.makeRequest(bbbUrl, {
        headers: { 'User-Agent': this.userAgent }
      });

      const $ = cheerio.load(response.data);
      const phones = [];
      const emails = [];

      // Extract contact info from BBB listings
      const pageText = $.text();
      this.phonePatterns.forEach(pattern => {
        const matches = pageText.match(pattern);
        if (matches) phones.push(...matches);
      });

      return { phones, emails, source: 'bbb' };

    } catch (err) {
      logger.error('BBB search failed', { companyName, error: err.message });
      return { phones: [], emails: [], source: 'bbb' };
    }
  }

  // Search Manta business directory
  async searchManta(companyName, city = '') {
    try {
      const searchQuery = city 
        ? `${companyName} ${city}`
        : companyName;
      
      const encodedQuery = encodeURIComponent(searchQuery);
      const mantaUrl = `https://www.manta.com/search?search=${encodedQuery}`;
      
      const response = await this.makeRequest(mantaUrl, {
        headers: { 'User-Agent': this.userAgent }
      });

      const $ = cheerio.load(response.data);
      const phones = [];
      const emails = [];

      // Extract contact info from Manta
      const pageText = $.text();
      this.phonePatterns.forEach(pattern => {
        const matches = pageText.match(pattern);
        if (matches) phones.push(...matches);
      });

      return { phones, emails, source: 'manta' };

    } catch (err) {
      logger.error('Manta search failed', { companyName, error: err.message });
      return { phones: [], emails: [], source: 'manta' };
    }
  }

  // Clean and validate phone numbers
  cleanPhoneNumbers(phones) {
    const cleaned = [];
    const seen = new Set();

    phones.forEach(phone => {
      if (!phone) return;
      
      // Remove all non-digit characters except +
      let cleanPhone = phone.replace(/[^\d+]/g, '');
      
      // Handle different formats
      if (cleanPhone.startsWith('1') && cleanPhone.length === 11) {
        cleanPhone = '+' + cleanPhone;
      } else if (cleanPhone.length === 10) {
        cleanPhone = '+1' + cleanPhone;
      } else if (!cleanPhone.startsWith('+') && cleanPhone.length === 10) {
        cleanPhone = '+1' + cleanPhone;
      }

      // Validate US phone number format
      if (/^\+1\d{10}$/.test(cleanPhone) && !seen.has(cleanPhone)) {
        cleaned.push(cleanPhone);
        seen.add(cleanPhone);
      }
    });

    return cleaned;
  }

  // Clean and validate email addresses
  cleanEmails(emails) {
    const cleaned = [];
    const seen = new Set();

    emails.forEach(email => {
      if (!email) return;
      
      const cleanEmail = email.toLowerCase().trim();
      
      // Basic email validation
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) && !seen.has(cleanEmail)) {
        // Filter out common non-business emails
        const excludePatterns = [
          /@gmail\.com$/,
          /@yahoo\.com$/,
          /@hotmail\.com$/,
          /@outlook\.com$/,
          /@aol\.com$/,
          /noreply@/,
          /no-reply@/,
          /donotreply@/
        ];

        const isExcluded = excludePatterns.some(pattern => pattern.test(cleanEmail));
        
        if (!isExcluded) {
          cleaned.push(cleanEmail);
          seen.add(cleanEmail);
        }
      }
    });

    return cleaned;
  }

  // Check if a URL is a valid business website
  isValidBusinessWebsite(url, companyName) {
    if (!url || !url.startsWith('http')) return false;
    
    // Exclude social media, directories, and other non-business sites
    const excludeDomains = [
      'facebook.com', 'twitter.com', 'instagram.com', 'linkedin.com',
      'yelp.com', 'yellowpages.com', 'bbb.org', 'manta.com',
      'google.com', 'youtube.com', 'wikipedia.org'
    ];

    const domain = new URL(url).hostname.toLowerCase();
    return !excludeDomains.some(excluded => domain.includes(excluded));
  }

  // Update lead with found contact information
  async updateLeadContacts(leadId, contacts) {
    try {
      const updates = {};
      
      if (contacts.phones.length > 0) {
        updates.phone = contacts.phones[0]; // Use first phone number
      }
      
      if (contacts.emails.length > 0) {
        updates.email = contacts.emails[0]; // Use first email
      }
      
      if (contacts.website) {
        updates.website = contacts.website;
      }

      if (Object.keys(updates).length > 0) {
        const setClause = Object.keys(updates)
          .map((key, index) => `${key} = $${index + 2}`)
          .join(', ');
        
        const values = [leadId, ...Object.values(updates)];
        
        await query(`
          UPDATE leads 
          SET ${setClause}, last_updated = CURRENT_TIMESTAMP
          WHERE id = $1
        `, values);

        logger.info('Lead contacts updated', { leadId, updates });
      }

    } catch (err) {
      logger.error('Failed to update lead contacts', { leadId, error: err.message });
      throw err;
    }
  }

  // Log enrichment attempt for tracking
  async logEnrichmentAttempt(leadId, enrichmentData) {
    try {
      await query(`
        INSERT INTO contact_enrichment_log (
          lead_id, phones_found, emails_found, website_found, 
          sources, enrichment_date, success
        ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6)
      `, [
        leadId,
        enrichmentData.foundContacts.phones.length,
        enrichmentData.foundContacts.emails.length,
        enrichmentData.foundContacts.website ? true : false,
        JSON.stringify(enrichmentData.sources),
        enrichmentData.foundContacts.phones.length > 0 || enrichmentData.foundContacts.emails.length > 0
      ]);

    } catch (err) {
      // Don't fail the enrichment if logging fails
      logger.error('Failed to log enrichment attempt', { leadId, error: err.message });
    }
  }

  // Bulk enrich leads without contact info
  async enrichLeadsWithoutContacts(limit = 50) {
    try {
      logger.info('Starting bulk contact enrichment', { limit });

      // Get leads without phone or email
      const leadsResult = await query(`
        SELECT id, company_name, city, state
        FROM leads 
        WHERE (phone IS NULL OR email IS NULL)
          AND status = 'active'
          AND state = 'FL'
          AND registration_date >= CURRENT_DATE - INTERVAL '30 days'
          AND NOT EXISTS (
            SELECT 1 FROM contact_enrichment_log 
            WHERE lead_id = leads.id 
              AND enrichment_date >= CURRENT_DATE - INTERVAL '7 days'
          )
        ORDER BY registration_date DESC
        LIMIT $1
      `, [limit]);

      const leads = leadsResult.rows;
      
      if (leads.length === 0) {
        logger.info('No leads found for enrichment');
        return { processed: 0, enriched: 0 };
      }

      let processed = 0;
      let enriched = 0;

      for (const lead of leads) {
        try {
          const result = await this.enrichLead(lead.id);
          processed++;
          
          if (result.foundContacts.phones.length > 0 || result.foundContacts.emails.length > 0) {
            enriched++;
          }

          // Delay between enrichments to be respectful
          await this.delay(this.requestDelay * 2);

        } catch (err) {
          logger.error('Failed to enrich lead', { leadId: lead.id, error: err.message });
          processed++;
        }
      }

      logger.info('Bulk enrichment completed', { processed, enriched });
      
      return { processed, enriched };

    } catch (err) {
      logger.error('Bulk enrichment failed', { error: err.message });
      throw err;
    }
  }

  // Make HTTP request with retry logic
  async makeRequest(url, options = {}, attempt = 1) {
    try {
      const response = await axios.get(url, {
        timeout: 15000,
        ...options
      });
      return response;
    } catch (err) {
      if (attempt < this.maxRetries && (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT')) {
        logger.warn('Request failed, retrying', { url, attempt, error: err.message });
        await this.delay(this.requestDelay * attempt);
        return this.makeRequest(url, options, attempt + 1);
      }
      throw err;
    }
  }

  // Utility delay function
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = ContactEnrichmentService;
