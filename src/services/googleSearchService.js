const axios = require('axios');
const { logger } = require('../database/connection');

class GoogleSearchService {
  constructor() {
    this.apiKey = process.env.GOOGLE_API_KEY;
    this.searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;
    this.baseUrl = 'https://www.googleapis.com/customsearch/v1';
    this.maxRetries = 3;
    this.retryDelay = 1000;
  }

  // Search Google for business contact information
  async searchBusiness(companyName, city, state) {
    try {
      if (!this.apiKey || !this.searchEngineId) {
        throw new Error('Google Search API credentials not configured');
      }

      // Create search queries
      const queries = [
        `"${companyName}" ${city} ${state} phone contact`,
        `"${companyName}" ${city} FL phone number`,
        `${companyName} contact information ${city} Florida`
      ];

      let bestResult = null;
      
      // Try each query until we find good results
      for (const query of queries) {
        const result = await this.performSearch(query);
        if (result && (result.phone || result.email || result.website)) {
          bestResult = result;
          break;
        }
      }

      return bestResult;

    } catch (err) {
      logger.error('Google search failed', { 
        company: companyName, 
        city, 
        error: err.message 
      });
      throw err;
    }
  }

  // Perform actual Google Custom Search
  async performSearch(query, attempt = 1) {
    try {
      logger.info('Google search', { query });

      const params = {
        key: this.apiKey,
        cx: this.searchEngineId,
        q: query,
        num: 10 // Get top 10 results
      };

      const response = await axios.get(this.baseUrl, {
        params,
        timeout: 10000
      });

      if (!response.data || !response.data.items) {
        return null;
      }

      // Extract contact info from search results
      return this.extractContactInfo(response.data.items, query);

    } catch (err) {
      if (attempt < this.maxRetries && this.isRetryableError(err)) {
        logger.warn(`Google search attempt ${attempt} failed, retrying...`, { error: err.message });
        await this.delay(this.retryDelay * attempt);
        return this.performSearch(query, attempt + 1);
      }

      // Handle specific Google API errors
      if (err.response) {
        const status = err.response.status;
        if (status === 403) {
          throw new Error('Google API quota exceeded or invalid key');
        } else if (status === 400) {
          throw new Error('Invalid Google search parameters');
        }
      }

      throw new Error(`Google search failed: ${err.message}`);
    }
  }

  // Extract contact information from Google search results
  extractContactInfo(searchResults, originalQuery) {
    const contactInfo = {
      phone: null,
      email: null,
      website: null,
      sources: [],
      confidence: 0
    };

    for (const item of searchResults) {
      const text = `${item.title} ${item.snippet} ${item.link}`.toLowerCase();
      
      // Extract phone numbers
      const phones = this.extractPhoneNumbers(text);
      if (phones.length > 0 && !contactInfo.phone) {
        contactInfo.phone = this.formatPhoneNumber(phones[0]);
        contactInfo.sources.push({
          type: 'phone',
          source: 'google_search',
          url: item.link,
          title: item.title
        });
      }

      // Extract email addresses
      const emails = this.extractEmails(text);
      if (emails.length > 0 && !contactInfo.email) {
        // Prefer business emails over personal ones
        const businessEmail = emails.find(email => 
          !email.includes('gmail.com') && 
          !email.includes('yahoo.com') && 
          !email.includes('hotmail.com')
        ) || emails[0];
        
        contactInfo.email = businessEmail;
        contactInfo.sources.push({
          type: 'email',
          source: 'google_search',
          url: item.link,
          title: item.title
        });
      }

      // Extract website
      if (!contactInfo.website && this.isBusinessWebsite(item.link)) {
        contactInfo.website = item.link;
        contactInfo.sources.push({
          type: 'website',
          source: 'google_search',
          url: item.link,
          title: item.title
        });
      }
    }

    // Calculate confidence score
    contactInfo.confidence = this.calculateConfidence(contactInfo, originalQuery);

    return contactInfo.phone || contactInfo.email || contactInfo.website ? contactInfo : null;
  }

  // Extract phone numbers from text
  extractPhoneNumbers(text) {
    const phonePatterns = [
      /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, // 123-456-7890, 123.456.7890, 123 456 7890
      /\(\d{3}\)\s?\d{3}[-.\s]?\d{4}/g,     // (123) 456-7890
      /\b\d{10}\b/g,                        // 1234567890
      /\+1[-.\s]?\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/g // +1-123-456-7890
    ];

    const phones = [];
    for (const pattern of phonePatterns) {
      const matches = text.match(pattern);
      if (matches) {
        phones.push(...matches);
      }
    }

    // Filter out common false positives
    return phones.filter(phone => {
      const digits = phone.replace(/\D/g, '');
      return digits.length === 10 || (digits.length === 11 && digits.startsWith('1'));
    });
  }

  // Extract email addresses from text
  extractEmails(text) {
    const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
    const matches = text.match(emailPattern);
    
    if (!matches) return [];

    // Filter out common false positives
    return matches.filter(email => 
      !email.includes('example.com') &&
      !email.includes('test.com') &&
      !email.includes('placeholder')
    );
  }

  // Check if URL is likely a business website
  isBusinessWebsite(url) {
    const businessIndicators = [
      'contact', 'about', 'services', 'business', 'company',
      '.com', '.net', '.org', '.biz'
    ];
    
    const excludePatterns = [
      'facebook.com', 'twitter.com', 'linkedin.com', 'instagram.com',
      'yelp.com', 'google.com', 'youtube.com', 'wikipedia.org'
    ];

    const lowerUrl = url.toLowerCase();
    
    // Exclude social media and directory sites
    if (excludePatterns.some(pattern => lowerUrl.includes(pattern))) {
      return false;
    }

    // Check for business indicators
    return businessIndicators.some(indicator => lowerUrl.includes(indicator));
  }

  // Format phone number to standard format
  formatPhoneNumber(phone) {
    const digits = phone.replace(/\D/g, '');
    
    if (digits.length === 10) {
      return `+1${digits}`;
    } else if (digits.length === 11 && digits.startsWith('1')) {
      return `+${digits}`;
    }
    
    return phone; // Return original if can't format
  }

  // Calculate confidence score for extracted data
  calculateConfidence(contactInfo, originalQuery) {
    let confidence = 0;
    
    if (contactInfo.phone) confidence += 40;
    if (contactInfo.email) confidence += 30;
    if (contactInfo.website) confidence += 20;
    
    // Bonus for multiple contact methods
    const contactMethods = [contactInfo.phone, contactInfo.email, contactInfo.website].filter(Boolean).length;
    if (contactMethods > 1) confidence += 10;
    
    return Math.min(confidence, 100);
  }

  // Check if error is retryable
  isRetryableError(err) {
    if (!err.response) return true; // Network errors are retryable
    
    const status = err.response.status;
    // Retry on server errors, but not on quota/auth errors
    return status >= 500;
  }

  // Utility function for delays
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Get search statistics
  async getSearchStats() {
    // This would track API usage, success rates, etc.
    return {
      dailyQuota: 100, // Google Custom Search free tier
      used: 0, // Would track actual usage
      remaining: 100
    };
  }
}

module.exports = GoogleSearchService;
