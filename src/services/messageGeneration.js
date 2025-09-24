const { query, logger } = require('../database/connection');

class MessageGenerationService {
  constructor() {
    this.affiliateLinks = {
      ein: process.env.EIN_AFFILIATE_URL || 'https://example.com/ein',
      banking: process.env.BANKING_AFFILIATE_URL || 'https://example.com/banking',
      accounting: process.env.ACCOUNTING_AFFILIATE_URL || 'https://example.com/accounting',
      insurance: process.env.INSURANCE_AFFILIATE_URL || 'https://example.com/insurance',
      compliance: process.env.COMPLIANCE_AFFILIATE_URL || process.env.EIN_AFFILIATE_URL || 'https://example.com/compliance'
    };
    
    this.unsubscribeBaseUrl = process.env.UNSUBSCRIBE_URL || 'https://yourapp.com/unsubscribe';
  }

  // Generate personalized message content
  async generateMessage(leadId, templateName, additionalData = {}) {
    try {
      // Get lead data
      const leadResult = await query('SELECT * FROM leads WHERE id = $1', [leadId]);
      if (leadResult.rows.length === 0) {
        throw new Error('Lead not found');
      }
      const lead = leadResult.rows[0];

      // Get template
      const templateResult = await query(
        'SELECT * FROM message_templates WHERE name = $1 AND is_active = true',
        [templateName]
      );
      if (templateResult.rows.length === 0) {
        throw new Error('Template not found or inactive');
      }
      const template = templateResult.rows[0];

      // Build personalization data
      const personalizationData = this.buildPersonalizationData(lead, additionalData);

      // Generate content
      const content = this.replaceVariables(template.content, personalizationData);
      const subject = template.subject ? this.replaceVariables(template.subject, personalizationData) : null;

      // Determine recipient
      const recipient = this.getRecipient(lead, template.type);
      if (!recipient.contact) {
        throw new Error(`No ${template.type} contact available for lead`);
      }

      return {
        leadId,
        messageType: template.type,
        templateName,
        recipient,
        subject,
        content,
        personalizedData: personalizationData,
        affiliateLinks: this.getAffiliateLinks(personalizationData)
      };

    } catch (err) {
      logger.error('Message generation failed', { leadId, templateName, error: err.message });
      throw err;
    }
  }

  // Build personalization data object
  buildPersonalizationData(lead, additionalData = {}) {
    const data = {
      // Lead information
      company_name: lead.company_name,
      state: lead.state,
      business_type: lead.business_type || 'LLC',
      industry: lead.industry || 'business',
      city: lead.city || '',
      
      // Contact information
      phone: lead.phone || '',
      email: lead.email || '',
      
      // Owner name (derived from company name or use generic)
      owner_name: this.extractOwnerName(lead.company_name) || 'Business Owner',
      
      // Business type specific recommendations
      business_recommendation: this.getBusinessRecommendation(lead.business_type, 'general'),
      banking_recommendation: this.getBusinessRecommendation(lead.business_type, 'banking'),
      accounting_recommendation: this.getBusinessRecommendation(lead.business_type, 'accounting'),
      compliance_recommendation: this.getBusinessRecommendation(lead.business_type, 'compliance'),
      insurance_recommendation: this.getBusinessRecommendation(lead.business_type, 'insurance'),
      
      // Dates
      registration_date: lead.registration_date ? this.formatDate(lead.registration_date) : '',
      days_since_registration: lead.registration_date ? this.daysSince(lead.registration_date) : '',
      
      // Affiliate links with specific services
      ein_link: this.addTrackingToUrl(this.affiliateLinks.ein, lead.id, 'ein'),
      banking_link: this.addTrackingToUrl(this.affiliateLinks.banking, lead.id, 'banking'),
      accounting_link: this.addTrackingToUrl(this.affiliateLinks.accounting, lead.id, 'accounting'),
      insurance_link: this.addTrackingToUrl(this.affiliateLinks.insurance, lead.id, 'insurance'),
      compliance_link: this.addTrackingToUrl(this.affiliateLinks.compliance || this.affiliateLinks.ein, lead.id, 'compliance'),
      
      // General affiliate link (rotates between services)
      affiliate_link: this.getRotatedAffiliateLink(lead.id),
      
      // Unsubscribe links
      unsubscribe_link: `${this.unsubscribeBaseUrl}?lead=${lead.id}&type=email`,
      sms_opt_out: `${this.unsubscribeBaseUrl}?lead=${lead.id}&type=sms`,
      
      // Merge additional data
      ...additionalData
    };

    return data;
  }

  // Replace template variables with actual data
  replaceVariables(template, data) {
    let content = template;
    
    // Replace {{variable}} patterns
    const variablePattern = /\{\{(\w+)\}\}/g;
    content = content.replace(variablePattern, (match, variable) => {
      return data[variable] || match; // Keep original if no replacement found
    });

    // Handle conditional blocks {{#if variable}}...{{/if}}
    const conditionalPattern = /\{\{#if (\w+)\}\}(.*?)\{\{\/if\}\}/gs;
    content = content.replace(conditionalPattern, (match, variable, block) => {
      return data[variable] ? block : '';
    });

    // Handle negative conditional blocks {{#unless variable}}...{{/unless}}
    const unlessPattern = /\{\{#unless (\w+)\}\}(.*?)\{\{\/unless\}\}/gs;
    content = content.replace(unlessPattern, (match, variable, block) => {
      return !data[variable] ? block : '';
    });

    return content.trim();
  }

  // Get recipient information based on message type
  getRecipient(lead, messageType) {
    if (messageType === 'sms') {
      return {
        contact: lead.phone,
        type: 'phone'
      };
    } else if (messageType === 'email') {
      return {
        contact: lead.email,
        type: 'email'
      };
    }
    
    throw new Error('Invalid message type');
  }

  // Add tracking parameters to affiliate URLs
  addTrackingToUrl(baseUrl, leadId, service) {
    try {
      const url = new URL(baseUrl);
      url.searchParams.set('ref', leadId);
      url.searchParams.set('service', service);
      url.searchParams.set('source', 'llc_outreach');
      return url.toString();
    } catch (err) {
      logger.warn('Invalid affiliate URL', { baseUrl, error: err.message });
      return baseUrl;
    }
  }

  // Get rotated affiliate link based on lead ID
  getRotatedAffiliateLink(leadId) {
    const services = ['ein', 'banking', 'accounting', 'insurance'];
    const hash = this.simpleHash(leadId);
    const serviceIndex = hash % services.length;
    const service = services[serviceIndex];
    
    return this.addTrackingToUrl(this.affiliateLinks[service], leadId, service);
  }

  // Simple hash function for consistent rotation
  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  // Format date for display
  formatDate(date) {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  // Calculate days since a date
  daysSince(date) {
    const now = new Date();
    const past = new Date(date);
    const diffTime = Math.abs(now - past);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  // Extract owner name from company name (basic implementation)
  extractOwnerName(companyName) {
    if (!companyName) return null;
    
    // Remove common business suffixes
    const cleanName = companyName
      .replace(/\s+(LLC|Inc|Corp|Corporation|Company|Co|Ltd|Limited)\s*$/i, '')
      .trim();
    
    // If it looks like a person's name (has spaces and reasonable length)
    if (cleanName.includes(' ') && cleanName.length <= 50) {
      // Check if it might be a person's name vs business name
      const words = cleanName.split(' ');
      if (words.length === 2 && words.every(word => word.length > 1)) {
        return cleanName;
      }
    }
    
    // Default to generic greeting
    return null;
  }

  // Generate business type specific recommendations
  getBusinessRecommendation(businessType, category) {
    const type = (businessType || 'LLC').toUpperCase();
    
    const recommendations = {
      'LLC': {
        general: 'LLCs provide excellent liability protection while maintaining operational flexibility.',
        banking: 'Separate business banking is crucial for maintaining your LLC\'s liability protection.',
        accounting: 'Proper bookkeeping helps you track expenses and maximize tax deductions.',
        compliance: 'Stay compliant with annual filings to maintain your LLC status.',
        insurance: 'General liability insurance is essential for most LLCs.'
      },
      'PLLC': {
        general: 'Professional LLCs have specific licensing and compliance requirements.',
        banking: 'Professional service businesses benefit from dedicated business accounts for client payments.',
        accounting: 'Professional services require careful expense tracking for licensing and continuing education.',
        compliance: 'PLLCs must maintain professional licenses and meet continuing education requirements.',
        insurance: 'Professional liability insurance is typically required for PLLCs.'
      },
      'SERIES LLC': {
        general: 'Series LLCs allow you to create separate liability protection for different business ventures.',
        banking: 'Each series may need separate banking to maintain liability separation.',
        accounting: 'Series LLCs require detailed accounting to track each series separately.',
        compliance: 'Each series has its own compliance requirements and filings.',
        insurance: 'Consider separate insurance policies for each series based on their specific risks.'
      },
      'SINGLE MEMBER LLC': {
        general: 'Single member LLCs offer liability protection with simplified tax reporting.',
        banking: 'Business banking helps establish business credit and simplifies tax preparation.',
        accounting: 'Track business expenses separately to maximize deductions on your personal return.',
        compliance: 'Maintain proper documentation to preserve your liability protection.',
        insurance: 'Protect your personal assets with appropriate business insurance coverage.'
      },
      'MULTI MEMBER LLC': {
        general: 'Multi-member LLCs require clear operating agreements and profit-sharing arrangements.',
        banking: 'Business banking is essential for tracking member contributions and distributions.',
        accounting: 'Detailed bookkeeping helps manage member equity and profit allocations.',
        compliance: 'File partnership returns and issue K-1s to all members annually.',
        insurance: 'Consider key person insurance to protect against loss of essential members.'
      }
    };

    // Check for specific business type first
    if (recommendations[type] && recommendations[type][category]) {
      return recommendations[type][category];
    }

    // Check for partial matches
    if (type.includes('PLLC') || type.includes('PROFESSIONAL')) {
      return recommendations['PLLC'][category] || recommendations['LLC'][category];
    }
    
    if (type.includes('SERIES')) {
      return recommendations['SERIES LLC'][category] || recommendations['LLC'][category];
    }

    // Default to standard LLC recommendations
    return recommendations['LLC'][category] || 'This step is important for your business success.';
  }

  // Get affiliate links for tracking
  getAffiliateLinks(personalizationData) {
    return {
      ein: personalizationData.ein_link,
      banking: personalizationData.banking_link,
      accounting: personalizationData.accounting_link,
      insurance: personalizationData.insurance_link,
      primary: personalizationData.affiliate_link
    };
  }

  // Generate multiple message variations for A/B testing
  async generateMessageVariations(leadId, templateNames, additionalData = {}) {
    const variations = [];
    
    for (const templateName of templateNames) {
      try {
        const message = await this.generateMessage(leadId, templateName, additionalData);
        variations.push({
          templateName,
          ...message
        });
      } catch (err) {
        logger.warn('Failed to generate message variation', { leadId, templateName, error: err.message });
      }
    }
    
    return variations;
  }

  // Create personalized message for campaign
  async createCampaignMessage(leadId, campaignId, templateName = null) {
    try {
      // Get campaign details
      const campaignResult = await query('SELECT * FROM campaigns WHERE id = $1', [campaignId]);
      if (campaignResult.rows.length === 0) {
        throw new Error('Campaign not found');
      }
      const campaign = campaignResult.rows[0];

      // Use campaign template if not specified
      const finalTemplateName = templateName || (await this.getCampaignTemplateName(campaign));

      // Generate message
      const messageData = await this.generateMessage(leadId, finalTemplateName, {
        campaign_name: campaign.name,
        campaign_id: campaignId
      });

      // Store message in database
      const insertResult = await query(`
        INSERT INTO messages (
          lead_id, message_type, template_name, recipient_phone, recipient_email,
          subject, content, personalized_data, affiliate_links, campaign_id, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
        RETURNING id
      `, [
        leadId,
        messageData.messageType,
        messageData.templateName,
        messageData.messageType === 'sms' ? messageData.recipient.contact : null,
        messageData.messageType === 'email' ? messageData.recipient.contact : null,
        messageData.subject,
        messageData.content,
        JSON.stringify(messageData.personalizedData),
        JSON.stringify(messageData.affiliateLinks),
        campaignId
      ]);

      const messageId = insertResult.rows[0].id;
      
      logger.info('Campaign message created', { messageId, leadId, campaignId, templateName: finalTemplateName });
      
      return {
        messageId,
        ...messageData
      };

    } catch (err) {
      logger.error('Campaign message creation failed', { leadId, campaignId, error: err.message });
      throw err;
    }
  }

  // Get template name for campaign
  async getCampaignTemplateName(campaign) {
    if (campaign.template_id) {
      const templateResult = await query('SELECT name FROM message_templates WHERE id = $1', [campaign.template_id]);
      if (templateResult.rows.length > 0) {
        return templateResult.rows[0].name;
      }
    }
    
    // Default templates based on message type
    return campaign.message_type === 'sms' ? 'llc_welcome_sms' : 'llc_welcome_email';
  }

  // Validate message content
  validateMessage(messageData) {
    const errors = [];
    
    if (!messageData.content || messageData.content.trim().length === 0) {
      errors.push('Message content is required');
    }
    
    if (messageData.messageType === 'sms') {
      if (messageData.content.length > 1600) {
        errors.push('SMS message too long (max 1600 characters)');
      }
      if (!messageData.recipient.contact) {
        errors.push('Phone number is required for SMS');
      }
    }
    
    if (messageData.messageType === 'email') {
      if (!messageData.subject || messageData.subject.trim().length === 0) {
        errors.push('Email subject is required');
      }
      if (!messageData.recipient.contact) {
        errors.push('Email address is required for email');
      }
    }
    
    return errors;
  }

  // Get message statistics
  async getMessageStats(campaignId = null, days = 30) {
    let whereClause = `WHERE created_at >= CURRENT_DATE - INTERVAL '${days} days'`;
    const params = [];
    
    if (campaignId) {
      whereClause += ' AND campaign_id = $1';
      params.push(campaignId);
    }
    
    const result = await query(`
      SELECT 
        message_type,
        status,
        COUNT(*) as count,
        DATE_TRUNC('day', created_at) as date
      FROM messages 
      ${whereClause}
      GROUP BY message_type, status, DATE_TRUNC('day', created_at)
      ORDER BY date DESC, message_type, status
    `, params);
    
    return result.rows;
  }
}

module.exports = MessageGenerationService;
