const express = require('express');
const SequenceCampaignService = require('../services/sequenceCampaign');
const { query, logger } = require('../database/connection');

const router = express.Router();
const sequenceService = new SequenceCampaignService();

// Create LLC sequence campaign
router.post('/llc-sequence', async (req, res) => {
  try {
    const {
      name = 'LLC Welcome Sequence',
      messageType = 'email',
      targetStates = [],
      minRegistrationDays = 0,
      maxRegistrationDays = 30,
      dailyLimit = 50,
      hourlyLimit = 10
    } = req.body;

    const campaign = await sequenceService.createLLCSequenceCampaign({
      name,
      messageType,
      targetStates,
      minRegistrationDays,
      maxRegistrationDays,
      dailyLimit,
      hourlyLimit
    });

    res.json({
      success: true,
      data: campaign,
      message: 'LLC sequence campaign created successfully'
    });

  } catch (err) {
    logger.error('Failed to create LLC sequence campaign', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Generate sequence messages for a specific lead
router.post('/generate/:leadId', async (req, res) => {
  try {
    const { leadId } = req.params;
    const { campaignId, messageType = 'email' } = req.body;

    if (!campaignId) {
      return res.status(400).json({
        success: false,
        error: 'Campaign ID is required'
      });
    }

    const result = await sequenceService.generateSequenceMessages(leadId, campaignId, messageType);

    res.json({
      success: true,
      data: result
    });

  } catch (err) {
    logger.error('Failed to generate sequence messages', { 
      leadId: req.params.leadId, 
      error: err.message 
    });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Process all sequence campaigns
router.post('/process', async (req, res) => {
  try {
    const { limit = 100 } = req.body;

    const result = await sequenceService.processSequenceCampaigns(limit);

    res.json({
      success: true,
      data: result,
      message: `Processed ${result.processed} leads across ${result.campaigns} campaigns`
    });

  } catch (err) {
    logger.error('Failed to process sequence campaigns', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get sequence progress for a lead
router.get('/progress/:leadId/:campaignId', async (req, res) => {
  try {
    const { leadId, campaignId } = req.params;

    const progress = await sequenceService.getSequenceProgress(leadId, campaignId);

    res.json({
      success: true,
      data: progress
    });

  } catch (err) {
    logger.error('Failed to get sequence progress', { 
      leadId: req.params.leadId, 
      campaignId: req.params.campaignId, 
      error: err.message 
    });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get sequence statistics for a campaign
router.get('/stats/:campaignId', async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { days = 30 } = req.query;

    const stats = await sequenceService.getSequenceStats(campaignId, parseInt(days));

    res.json({
      success: true,
      data: stats
    });

  } catch (err) {
    logger.error('Failed to get sequence stats', { 
      campaignId: req.params.campaignId, 
      error: err.message 
    });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get all leads in sequence campaigns with their progress
router.get('/leads', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      campaignId,
      state,
      status
    } = req.query;

    let whereConditions = ['c.name ILIKE \'%sequence%\''];
    let params = [];
    let paramIndex = 1;

    if (campaignId) {
      whereConditions.push(`c.id = $${paramIndex++}`);
      params.push(campaignId);
    }

    if (state) {
      whereConditions.push(`l.state = $${paramIndex++}`);
      params.push(state);
    }

    if (status) {
      whereConditions.push(`l.status = $${paramIndex++}`);
      params.push(status);
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const leadsQuery = `
      SELECT DISTINCT
        l.id,
        l.company_name,
        l.state,
        l.registration_date,
        l.phone,
        l.email,
        c.id as campaign_id,
        c.name as campaign_name,
        c.message_type,
        COUNT(m.id) as messages_sent,
        MAX(m.sent_at) as last_message_sent
      FROM leads l
      JOIN messages m ON l.id = m.lead_id
      JOIN campaigns c ON m.campaign_id = c.id
      ${whereClause}
      GROUP BY l.id, l.company_name, l.state, l.registration_date, l.phone, l.email, c.id, c.name, c.message_type
      ORDER BY l.registration_date DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

    params.push(parseInt(limit), offset);

    const result = await query(leadsQuery, params);

    // Get total count
    const countQuery = `
      SELECT COUNT(DISTINCT l.id) as total
      FROM leads l
      JOIN messages m ON l.id = m.lead_id
      JOIN campaigns c ON m.campaign_id = c.id
      ${whereClause}
    `;

    const countResult = await query(countQuery, params.slice(0, -2));
    const total = parseInt(countResult.rows[0].total);

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        total,
        limit: parseInt(limit),
        offset,
        pages: Math.ceil(total / parseInt(limit)),
        currentPage: parseInt(page)
      }
    });

  } catch (err) {
    logger.error('Failed to get sequence leads', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get sequence template information
router.get('/templates', async (req, res) => {
  try {
    const templates = sequenceService.llcSequence.map(step => ({
      day: step.day,
      name: step.name,
      description: step.description,
      smsTemplate: step.smsTemplate,
      emailTemplate: step.emailTemplate
    }));

    res.json({
      success: true,
      data: {
        totalSteps: templates.length,
        sequence: templates
      }
    });

  } catch (err) {
    logger.error('Failed to get sequence templates', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

module.exports = router;
