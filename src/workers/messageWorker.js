const cron = require('node-cron');
const { query, logger } = require('../database/connection');
const LeadFilteringService = require('../services/leadFiltering');
const MessageGenerationService = require('../services/messageGeneration');
const SequenceCampaignService = require('../services/sequenceCampaign');
const FloridaDataService = require('../services/floridaDataService');
const ContactEnrichmentService = require('../services/contactEnrichmentService');
const SMSService = require('../services/smsService');
const EmailService = require('../services/emailService');

class MessageWorker {
  constructor() {
    this.leadFiltering = new LeadFilteringService();
    this.messageGeneration = new MessageGenerationService();
    this.sequenceService = new SequenceCampaignService();
    this.floridaService = new FloridaDataService();
    this.enrichmentService = new ContactEnrichmentService();
    this.smsService = new SMSService();
    this.emailService = new EmailService();
    
    this.isRunning = false;
    this.dailyMessageCount = 0;
    this.hourlyMessageCount = 0;
    this.lastHourReset = new Date().getHours();
    this.lastDayReset = new Date().getDate();
    
    this.settings = {
      dailyLimit: 1000,
      hourlyLimit: 100,
      messageDelay: 5000, // 5 seconds between messages
      batchSize: 10,
      autoCampaignEnabled: true
    };
  }

  // Initialize worker and start cron jobs
  async start() {
    try {
      logger.info('Starting message worker...');
      
      // Load settings from database
      await this.loadSettings();
      
      // Reset counters at startup
      await this.resetCounters();
      
      // Schedule message processing every 5 minutes
      cron.schedule('*/5 * * * *', async () => {
        if (!this.isRunning) {
          await this.processMessages();
        }
      });
      
      // Schedule campaign processing every hour
      cron.schedule('0 * * * *', async () => {
        if (this.settings.autoCampaignEnabled) {
          await this.processCampaigns();
          await this.processSequenceCampaigns();
        }
      });
      
      // Schedule Florida data sync daily at 6 AM
      cron.schedule('0 6 * * *', async () => {
        await this.dailyFloridaSync();
      });
      
      // Schedule contact enrichment every 4 hours
      cron.schedule('0 */4 * * *', async () => {
        await this.enrichContactsDaily();
      });
      
      // Reset hourly counter every hour
      cron.schedule('0 * * * *', async () => {
        await this.resetHourlyCounter();
      });
      
      // Reset daily counter at midnight
      cron.schedule('0 0 * * *', async () => {
        await this.resetDailyCounter();
      });
      
      // Health check every 30 minutes
      cron.schedule('*/30 * * * *', async () => {
        await this.healthCheck();
      });
      
      logger.info('Message worker started successfully');
      
    } catch (err) {
      logger.error('Failed to start message worker', { error: err.message });
      throw err;
    }
  }

  // Load settings from database
  async loadSettings() {
    try {
      const result = await query('SELECT key, value FROM system_settings');
      
      result.rows.forEach(row => {
        switch (row.key) {
          case 'daily_message_limit':
            this.settings.dailyLimit = parseInt(row.value);
            break;
          case 'hourly_message_limit':
            this.settings.hourlyLimit = parseInt(row.value);
            break;
          case 'message_delay_seconds':
            this.settings.messageDelay = parseInt(row.value) * 1000;
            break;
          case 'auto_campaign_enabled':
            this.settings.autoCampaignEnabled = row.value === 'true';
            break;
        }
      });
      
      logger.info('Settings loaded', this.settings);
      
    } catch (err) {
      logger.error('Failed to load settings', { error: err.message });
    }
  }

  // Reset message counters
  async resetCounters() {
    const now = new Date();
    const currentHour = now.getHours();
    const currentDay = now.getDate();
    
    // Reset hourly counter if hour changed
    if (currentHour !== this.lastHourReset) {
      this.hourlyMessageCount = 0;
      this.lastHourReset = currentHour;
    }
    
    // Reset daily counter if day changed
    if (currentDay !== this.lastDayReset) {
      this.dailyMessageCount = 0;
      this.lastDayReset = currentDay;
    }
    
    // Get actual counts from database for current period
    const hourlyResult = await query(`
      SELECT COUNT(*) as count
      FROM messages 
      WHERE sent_at >= DATE_TRUNC('hour', CURRENT_TIMESTAMP)
        AND status IN ('sent', 'delivered')
    `);
    
    const dailyResult = await query(`
      SELECT COUNT(*) as count
      FROM messages 
      WHERE sent_at >= DATE_TRUNC('day', CURRENT_TIMESTAMP)
        AND status IN ('sent', 'delivered')
    `);
    
    this.hourlyMessageCount = parseInt(hourlyResult.rows[0].count);
    this.dailyMessageCount = parseInt(dailyResult.rows[0].count);
    
    logger.info('Counters reset', { 
      hourly: this.hourlyMessageCount, 
      daily: this.dailyMessageCount 
    });
  }

  // Process pending messages
  async processMessages() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    
    try {
      logger.info('Processing pending messages...');
      
      // Check rate limits
      if (this.dailyMessageCount >= this.settings.dailyLimit) {
        logger.warn('Daily message limit reached', { 
          count: this.dailyMessageCount, 
          limit: this.settings.dailyLimit 
        });
        return;
      }
      
      if (this.hourlyMessageCount >= this.settings.hourlyLimit) {
        logger.warn('Hourly message limit reached', { 
          count: this.hourlyMessageCount, 
          limit: this.settings.hourlyLimit 
        });
        return;
      }
      
      // Calculate available capacity
      const remainingDaily = this.settings.dailyLimit - this.dailyMessageCount;
      const remainingHourly = this.settings.hourlyLimit - this.hourlyMessageCount;
      const batchLimit = Math.min(remainingDaily, remainingHourly, this.settings.batchSize);
      
      if (batchLimit <= 0) {
        logger.info('No message capacity available');
        return;
      }
      
      // Get pending messages
      const pendingResult = await query(`
        SELECT id, message_type, lead_id, campaign_id
        FROM messages 
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT $1
      `, [batchLimit]);
      
      const pendingMessages = pendingResult.rows;
      
      if (pendingMessages.length === 0) {
        logger.info('No pending messages to process');
        return;
      }
      
      logger.info('Processing message batch', { 
        count: pendingMessages.length,
        batchLimit 
      });
      
      // Process messages with delay
      for (const message of pendingMessages) {
        try {
          let result;
          
          if (message.message_type === 'sms') {
            result = await this.smsService.sendSMS(message.id);
          } else if (message.message_type === 'email') {
            result = await this.emailService.sendEmail(message.id);
          }
          
          if (result && result.success) {
            this.hourlyMessageCount++;
            this.dailyMessageCount++;
            
            logger.info('Message sent successfully', { 
              messageId: message.id,
              type: message.message_type,
              campaignId: message.campaign_id 
            });
          }
          
          // Delay between messages
          if (this.settings.messageDelay > 0) {
            await this.delay(this.settings.messageDelay);
          }
          
        } catch (err) {
          logger.error('Failed to send message', { 
            messageId: message.id, 
            error: err.message 
          });
        }
      }
      
    } catch (err) {
      logger.error('Message processing failed', { error: err.message });
    } finally {
      this.isRunning = false;
    }
  }

  // Process active campaigns
  async processCampaigns() {
    try {
      logger.info('Processing active campaigns...');
      
      // Get active campaigns
      const campaignsResult = await query(`
        SELECT * FROM campaigns 
        WHERE is_active = true
          AND (start_date IS NULL OR start_date <= CURRENT_DATE)
          AND (end_date IS NULL OR end_date >= CURRENT_DATE)
        ORDER BY created_at ASC
      `);
      
      const campaigns = campaignsResult.rows;
      
      if (campaigns.length === 0) {
        logger.info('No active campaigns to process');
        return;
      }
      
      for (const campaign of campaigns) {
        try {
          await this.processCampaign(campaign);
        } catch (err) {
          logger.error('Failed to process campaign', { 
            campaignId: campaign.id, 
            error: err.message 
          });
        }
      }
      
    } catch (err) {
      logger.error('Campaign processing failed', { error: err.message });
    }
  }

  // Process individual campaign
  async processCampaign(campaign) {
    // Check campaign limits
    const todayMessagesResult = await query(`
      SELECT COUNT(*) as count
      FROM messages 
      WHERE campaign_id = $1 
        AND DATE(created_at) = CURRENT_DATE
    `, [campaign.id]);
    
    const todayCount = parseInt(todayMessagesResult.rows[0].count);
    
    if (todayCount >= campaign.daily_limit) {
      logger.info('Campaign daily limit reached', { 
        campaignId: campaign.id, 
        count: todayCount, 
        limit: campaign.daily_limit 
      });
      return;
    }
    
    const thisHourMessagesResult = await query(`
      SELECT COUNT(*) as count
      FROM messages 
      WHERE campaign_id = $1 
        AND created_at >= DATE_TRUNC('hour', CURRENT_TIMESTAMP)
    `, [campaign.id]);
    
    const thisHourCount = parseInt(thisHourMessagesResult.rows[0].count);
    
    if (thisHourCount >= campaign.hourly_limit) {
      logger.info('Campaign hourly limit reached', { 
        campaignId: campaign.id, 
        count: thisHourCount, 
        limit: campaign.hourly_limit 
      });
      return;
    }
    
    // Calculate how many messages we can generate
    const remainingDaily = campaign.daily_limit - todayCount;
    const remainingHourly = campaign.hourly_limit - thisHourCount;
    const generateLimit = Math.min(remainingDaily, remainingHourly, 50); // Max 50 per run
    
    if (generateLimit <= 0) {
      return;
    }
    
    // Get leads for this campaign
    const leadsResult = await this.leadFiltering.getLeadsForCampaign(campaign.id, generateLimit);
    const leads = leadsResult.leads;
    
    if (leads.length === 0) {
      logger.info('No leads available for campaign', { campaignId: campaign.id });
      return;
    }
    
    logger.info('Generating messages for campaign', { 
      campaignId: campaign.id, 
      leadCount: leads.length 
    });
    
    // Generate messages for leads
    let generatedCount = 0;
    
    for (const lead of leads) {
      try {
        await this.messageGeneration.createCampaignMessage(lead.id, campaign.id);
        generatedCount++;
      } catch (err) {
        logger.error('Failed to generate campaign message', { 
          leadId: lead.id, 
          campaignId: campaign.id, 
          error: err.message 
        });
      }
    }
    
    // Update campaign statistics
    if (generatedCount > 0) {
      await query(`
        UPDATE campaigns 
        SET total_targeted = total_targeted + $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [generatedCount, campaign.id]);
      
      logger.info('Campaign messages generated', { 
        campaignId: campaign.id, 
        generated: generatedCount 
      });
    }
  }

  // Process sequence campaigns
  async processSequenceCampaigns() {
    try {
      logger.info('Processing sequence campaigns...');
      
      const result = await this.sequenceService.processSequenceCampaigns(50);
      
      logger.info('Sequence campaigns processed', { 
        campaigns: result.campaigns, 
        processed: result.processed 
      });
      
    } catch (err) {
      logger.error('Sequence campaign processing failed', { error: err.message });
    }
  }

  // Daily Florida LLC data sync
  async dailyFloridaSync() {
    try {
      logger.info('Starting daily Florida LLC sync...');
      
      const result = await this.floridaService.dailySync(7); // Last 7 days
      
      logger.info('Daily Florida sync completed', {
        filesDownloaded: result.filesDownloaded,
        filesProcessed: result.filesProcessed,
        newRecords: result.newRecords
      });
      
    } catch (err) {
      logger.error('Daily Florida sync failed', { error: err.message });
    }
  }

  // Daily contact enrichment
  async enrichContactsDaily() {
    try {
      logger.info('Starting daily contact enrichment...');
      
      const result = await this.enrichmentService.enrichLeadsWithoutContacts(25); // Limit to 25 per run
      
      logger.info('Daily contact enrichment completed', {
        processed: result.processed,
        enriched: result.enriched
      });
      
    } catch (err) {
      logger.error('Daily contact enrichment failed', { error: err.message });
    }
  }

  // Reset hourly counter
  async resetHourlyCounter() {
    this.hourlyMessageCount = 0;
    this.lastHourReset = new Date().getHours();
    logger.info('Hourly counter reset');
  }

  // Reset daily counter
  async resetDailyCounter() {
    this.dailyMessageCount = 0;
    this.lastDayReset = new Date().getDate();
    logger.info('Daily counter reset');
  }

  // Health check
  async healthCheck() {
    try {
      // Check for stuck messages
      const stuckResult = await query(`
        SELECT COUNT(*) as count
        FROM messages 
        WHERE status = 'sending' 
          AND updated_at < CURRENT_TIMESTAMP - INTERVAL '1 hour'
      `);
      
      const stuckCount = parseInt(stuckResult.rows[0].count);
      
      if (stuckCount > 0) {
        logger.warn('Found stuck messages', { count: stuckCount });
        
        // Reset stuck messages to failed
        await query(`
          UPDATE messages 
          SET status = 'failed', 
              failure_reason = 'Timeout - message stuck in sending status',
              failed_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE status = 'sending' 
            AND updated_at < CURRENT_TIMESTAMP - INTERVAL '1 hour'
        `);
      }
      
      // Check for old pending messages
      const oldPendingResult = await query(`
        SELECT COUNT(*) as count
        FROM messages 
        WHERE status = 'pending' 
          AND created_at < CURRENT_TIMESTAMP - INTERVAL '24 hours'
      `);
      
      const oldPendingCount = parseInt(oldPendingResult.rows[0].count);
      
      if (oldPendingCount > 0) {
        logger.warn('Found old pending messages', { count: oldPendingCount });
      }
      
      logger.info('Health check completed', { 
        stuckMessages: stuckCount,
        oldPendingMessages: oldPendingCount,
        hourlyCount: this.hourlyMessageCount,
        dailyCount: this.dailyMessageCount
      });
      
    } catch (err) {
      logger.error('Health check failed', { error: err.message });
    }
  }

  // Get worker status
  getStatus() {
    return {
      isRunning: this.isRunning,
      settings: this.settings,
      counters: {
        hourly: this.hourlyMessageCount,
        daily: this.dailyMessageCount,
        lastHourReset: this.lastHourReset,
        lastDayReset: this.lastDayReset
      }
    };
  }

  // Utility delay function
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Stop worker
  stop() {
    logger.info('Stopping message worker...');
    this.isRunning = false;
  }
}

// Start worker if called directly
if (require.main === module) {
  const worker = new MessageWorker();
  worker.start().catch(err => {
    logger.error('Failed to start worker', { error: err.message });
    process.exit(1);
  });
  
  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, stopping worker');
    worker.stop();
    process.exit(0);
  });
  
  process.on('SIGINT', () => {
    logger.info('SIGINT received, stopping worker');
    worker.stop();
    process.exit(0);
  });
}

module.exports = MessageWorker;
