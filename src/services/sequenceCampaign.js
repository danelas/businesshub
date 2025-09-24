const { query, transaction, logger } = require('../database/connection');
const MessageGenerationService = require('./messageGeneration');

class SequenceCampaignService {
  constructor() {
    this.messageGeneration = new MessageGenerationService();
    
    // Define the LLC follow-up sequence
    this.llcSequence = [
      {
        day: 1,
        name: 'EIN / Tax ID',
        smsTemplate: 'llc_day1_ein_sms',
        emailTemplate: 'llc_day1_ein_email',
        description: 'Welcome message with EIN information'
      },
      {
        day: 3,
        name: 'Business Banking',
        smsTemplate: 'llc_day3_banking_sms',
        emailTemplate: 'llc_day3_banking_email',
        description: 'Business banking setup'
      },
      {
        day: 7,
        name: 'Accounting / Bookkeeping',
        smsTemplate: 'llc_day7_accounting_sms',
        emailTemplate: 'llc_day7_accounting_email',
        description: 'Accounting and bookkeeping services'
      },
      {
        day: 10,
        name: 'Registered Agent / Compliance',
        smsTemplate: 'llc_day10_compliance_sms',
        emailTemplate: 'llc_day10_compliance_email',
        description: 'Compliance and registered agent services'
      },
      {
        day: 15,
        name: 'Business Insurance',
        smsTemplate: 'llc_day15_insurance_sms',
        emailTemplate: 'llc_day15_insurance_email',
        description: 'Business insurance options'
      }
    ];
  }

  // Create a sequence campaign for new LLCs
  async createLLCSequenceCampaign(options = {}) {
    const {
      name = 'LLC Welcome Sequence',
      messageType = 'email', // 'sms', 'email', or 'both'
      targetStates = [],
      minRegistrationDays = 0,
      maxRegistrationDays = 30,
      dailyLimit = 50,
      hourlyLimit = 10
    } = options;

    try {
      return await transaction(async (client) => {
        // Create the main sequence campaign
        const campaignResult = await client.query(`
          INSERT INTO campaigns (
            name, description, message_type, target_states, 
            min_registration_date, max_registration_date,
            daily_limit, hourly_limit, is_active
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
          RETURNING *
        `, [
          name,
          'Automated LLC follow-up sequence with EIN, banking, accounting, compliance, and insurance information',
          messageType,
          targetStates.length > 0 ? targetStates : null,
          minRegistrationDays > 0 ? `CURRENT_DATE - INTERVAL '${minRegistrationDays} days'` : null,
          maxRegistrationDays > 0 ? `CURRENT_DATE - INTERVAL '${maxRegistrationDays} days'` : null,
          dailyLimit,
          hourlyLimit
        ]);

        const campaign = campaignResult.rows[0];

        logger.info('LLC sequence campaign created', { 
          campaignId: campaign.id, 
          name: campaign.name,
          messageType 
        });

        return campaign;
      });

    } catch (err) {
      logger.error('Failed to create LLC sequence campaign', { error: err.message });
      throw err;
    }
  }

  // Generate sequence messages for a lead based on registration date
  async generateSequenceMessages(leadId, campaignId, messageType = 'email') {
    try {
      // Get lead information
      const leadResult = await query('SELECT * FROM leads WHERE id = $1', [leadId]);
      if (leadResult.rows.length === 0) {
        throw new Error('Lead not found');
      }

      const lead = leadResult.rows[0];
      
      if (!lead.registration_date) {
        throw new Error('Lead must have a registration date for sequence campaigns');
      }

      const registrationDate = new Date(lead.registration_date);
      const now = new Date();
      const daysSinceRegistration = Math.floor((now - registrationDate) / (1000 * 60 * 60 * 24));

      logger.info('Generating sequence messages', { 
        leadId, 
        campaignId, 
        daysSinceRegistration,
        messageType 
      });

      const generatedMessages = [];

      // Generate messages for each step in the sequence
      for (const step of this.llcSequence) {
        const scheduledDate = new Date(registrationDate);
        scheduledDate.setDate(scheduledDate.getDate() + step.day);

        // Skip if this step is in the future
        if (scheduledDate > now) {
          continue;
        }

        // Check if we already sent this step
        const existingResult = await query(`
          SELECT id FROM messages 
          WHERE lead_id = $1 
            AND campaign_id = $2 
            AND template_name = $3
        `, [leadId, campaignId, messageType === 'sms' ? step.smsTemplate : step.emailTemplate]);

        if (existingResult.rows.length > 0) {
          logger.debug('Sequence step already sent', { 
            leadId, 
            step: step.name, 
            messageId: existingResult.rows[0].id 
          });
          continue;
        }

        // Generate the message
        try {
          const templateName = messageType === 'sms' ? step.smsTemplate : step.emailTemplate;
          const messageData = await this.messageGeneration.createCampaignMessage(
            leadId, 
            campaignId, 
            templateName
          );

          generatedMessages.push({
            step: step.name,
            day: step.day,
            messageId: messageData.messageId,
            templateName,
            scheduledDate
          });

          logger.info('Sequence message generated', { 
            leadId, 
            step: step.name, 
            messageId: messageData.messageId 
          });

        } catch (err) {
          logger.error('Failed to generate sequence message', { 
            leadId, 
            step: step.name, 
            error: err.message 
          });
        }
      }

      return {
        leadId,
        campaignId,
        daysSinceRegistration,
        generatedMessages,
        totalSteps: this.llcSequence.length
      };

    } catch (err) {
      logger.error('Failed to generate sequence messages', { leadId, campaignId, error: err.message });
      throw err;
    }
  }

  // Process all leads for sequence campaigns
  async processSequenceCampaigns(limit = 100) {
    try {
      logger.info('Processing sequence campaigns...');

      // Get active sequence campaigns
      const campaignsResult = await query(`
        SELECT * FROM campaigns 
        WHERE is_active = true 
          AND name ILIKE '%sequence%'
          AND (start_date IS NULL OR start_date <= CURRENT_DATE)
          AND (end_date IS NULL OR end_date >= CURRENT_DATE)
      `);

      const campaigns = campaignsResult.rows;

      if (campaigns.length === 0) {
        logger.info('No active sequence campaigns found');
        return { processed: 0, campaigns: 0 };
      }

      let totalProcessed = 0;

      for (const campaign of campaigns) {
        try {
          const processed = await this.processSingleSequenceCampaign(campaign, limit);
          totalProcessed += processed;
        } catch (err) {
          logger.error('Failed to process sequence campaign', { 
            campaignId: campaign.id, 
            error: err.message 
          });
        }
      }

      logger.info('Sequence campaign processing completed', { 
        campaigns: campaigns.length, 
        totalProcessed 
      });

      return { processed: totalProcessed, campaigns: campaigns.length };

    } catch (err) {
      logger.error('Failed to process sequence campaigns', { error: err.message });
      throw err;
    }
  }

  // Process a single sequence campaign
  async processSingleSequenceCampaign(campaign, limit = 100) {
    // Build filters for this campaign
    const filters = {
      status: ['active'],
      excludeOptedOut: true
    };

    if (campaign.target_states && campaign.target_states.length > 0) {
      filters.states = campaign.target_states;
    }

    if (campaign.min_registration_date) {
      filters.registrationDateFrom = campaign.min_registration_date;
    }

    if (campaign.max_registration_date) {
      filters.registrationDateTo = campaign.max_registration_date;
    }

    // Require appropriate contact method
    if (campaign.message_type === 'sms') {
      filters.requirePhone = true;
    } else if (campaign.message_type === 'email') {
      filters.requireEmail = true;
    }

    // Get leads that haven't completed the sequence
    const leadsQuery = `
      SELECT l.* FROM leads l
      WHERE l.status = 'active'
        AND l.registration_date IS NOT NULL
        AND l.registration_date >= CURRENT_DATE - INTERVAL '30 days'
        ${campaign.target_states ? `AND l.state = ANY($1)` : ''}
        ${campaign.message_type === 'sms' ? 'AND l.phone IS NOT NULL' : ''}
        ${campaign.message_type === 'email' ? 'AND l.email IS NOT NULL' : ''}
        AND NOT EXISTS (
          SELECT 1 FROM opt_outs o 
          WHERE (o.phone = l.phone AND o.opt_out_type IN ('sms', 'all'))
             OR (o.email = l.email AND o.opt_out_type IN ('email', 'all'))
             OR o.lead_id = l.id
        )
      ORDER BY l.registration_date ASC
      LIMIT $${campaign.target_states ? 2 : 1}
    `;

    const params = campaign.target_states ? [campaign.target_states, limit] : [limit];
    const leadsResult = await query(leadsQuery, params);
    const leads = leadsResult.rows;

    let processed = 0;

    for (const lead of leads) {
      try {
        const result = await this.generateSequenceMessages(
          lead.id, 
          campaign.id, 
          campaign.message_type
        );
        
        if (result.generatedMessages.length > 0) {
          processed++;
        }
      } catch (err) {
        logger.error('Failed to process lead for sequence', { 
          leadId: lead.id, 
          campaignId: campaign.id, 
          error: err.message 
        });
      }
    }

    return processed;
  }

  // Get sequence progress for a lead
  async getSequenceProgress(leadId, campaignId) {
    try {
      const messagesResult = await query(`
        SELECT 
          template_name,
          status,
          sent_at,
          delivered_at
        FROM messages 
        WHERE lead_id = $1 AND campaign_id = $2
        ORDER BY created_at ASC
      `, [leadId, campaignId]);

      const sentMessages = messagesResult.rows;
      const progress = [];

      for (const step of this.llcSequence) {
        const smsMessage = sentMessages.find(m => m.template_name === step.smsTemplate);
        const emailMessage = sentMessages.find(m => m.template_name === step.emailTemplate);

        progress.push({
          step: step.name,
          day: step.day,
          sms: smsMessage ? {
            status: smsMessage.status,
            sentAt: smsMessage.sent_at,
            deliveredAt: smsMessage.delivered_at
          } : null,
          email: emailMessage ? {
            status: emailMessage.status,
            sentAt: emailMessage.sent_at,
            deliveredAt: emailMessage.delivered_at
          } : null
        });
      }

      return {
        leadId,
        campaignId,
        totalSteps: this.llcSequence.length,
        completedSteps: progress.filter(p => p.sms || p.email).length,
        progress
      };

    } catch (err) {
      logger.error('Failed to get sequence progress', { leadId, campaignId, error: err.message });
      throw err;
    }
  }

  // Get sequence statistics
  async getSequenceStats(campaignId, days = 30) {
    try {
      const result = await query(`
        SELECT 
          template_name,
          COUNT(*) as total_sent,
          COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
          COUNT(CASE WHEN status = 'opted_out' THEN 1 END) as opted_out
        FROM messages 
        WHERE campaign_id = $1 
          AND created_at >= CURRENT_DATE - INTERVAL '${days} days'
        GROUP BY template_name
        ORDER BY template_name
      `, [campaignId]);

      const stats = {};
      
      this.llcSequence.forEach(step => {
        const smsStats = result.rows.find(r => r.template_name === step.smsTemplate);
        const emailStats = result.rows.find(r => r.template_name === step.emailTemplate);
        
        stats[step.name] = {
          day: step.day,
          sms: smsStats ? {
            totalSent: parseInt(smsStats.total_sent),
            delivered: parseInt(smsStats.delivered),
            failed: parseInt(smsStats.failed),
            optedOut: parseInt(smsStats.opted_out)
          } : { totalSent: 0, delivered: 0, failed: 0, optedOut: 0 },
          email: emailStats ? {
            totalSent: parseInt(emailStats.total_sent),
            delivered: parseInt(emailStats.delivered),
            failed: parseInt(emailStats.failed),
            optedOut: parseInt(emailStats.opted_out)
          } : { totalSent: 0, delivered: 0, failed: 0, optedOut: 0 }
        };
      });

      return stats;

    } catch (err) {
      logger.error('Failed to get sequence stats', { campaignId, error: err.message });
      throw err;
    }
  }
}

module.exports = SequenceCampaignService;
