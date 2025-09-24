const express = require('express');
const LeadFilteringService = require('../services/leadFiltering');
const MessageGenerationService = require('../services/messageGeneration');
const { query, transaction, logger } = require('../database/connection');

const router = express.Router();
const leadFiltering = new LeadFilteringService();
const messageGeneration = new MessageGenerationService();

// Get campaigns with pagination
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      isActive,
      messageType,
      orderBy = 'created_at',
      orderDirection = 'DESC'
    } = req.query;

    let whereConditions = [];
    let params = [];
    let paramIndex = 1;

    if (isActive !== undefined) {
      whereConditions.push(`is_active = $${paramIndex++}`);
      params.push(isActive === 'true');
    }

    if (messageType) {
      whereConditions.push(`message_type = $${paramIndex++}`);
      params.push(messageType);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Validate orderBy to prevent SQL injection
    const allowedOrderBy = ['created_at', 'name', 'start_date', 'end_date', 'total_sent'];
    const safeOrderBy = allowedOrderBy.includes(orderBy) ? orderBy : 'created_at';
    const safeDirection = orderDirection.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const campaignsQuery = `
      SELECT 
        c.*,
        t.name as template_name,
        t.type as template_type
      FROM campaigns c
      LEFT JOIN message_templates t ON c.template_id = t.id
      ${whereClause}
      ORDER BY c.${safeOrderBy} ${safeDirection}
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

    params.push(parseInt(limit), offset);

    const result = await query(campaignsQuery, params);

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM campaigns c
      ${whereClause}
    `;

    const countResult = await query(countQuery, params.slice(0, -2)); // Remove limit and offset
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
    logger.error('Failed to get campaigns', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get single campaign by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await query(`
      SELECT 
        c.*,
        t.name as template_name,
        t.content as template_content,
        t.subject as template_subject
      FROM campaigns c
      LEFT JOIN message_templates t ON c.template_id = t.id
      WHERE c.id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Campaign not found'
      });
    }

    // Get campaign statistics
    const statsResult = await query(`
      SELECT 
        status,
        COUNT(*) as count
      FROM messages 
      WHERE campaign_id = $1
      GROUP BY status
    `, [id]);

    const stats = {};
    statsResult.rows.forEach(row => {
      stats[row.status] = parseInt(row.count);
    });

    res.json({
      success: true,
      data: {
        campaign: result.rows[0],
        statistics: stats
      }
    });

  } catch (err) {
    logger.error('Failed to get campaign', { campaignId: req.params.id, error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Create new campaign
router.post('/', async (req, res) => {
  try {
    const {
      name,
      description,
      messageType,
      templateId,
      targetStates,
      targetBusinessTypes,
      targetIndustries,
      minRegistrationDate,
      maxRegistrationDate,
      dailyLimit = 100,
      hourlyLimit = 10,
      startDate,
      endDate
    } = req.body;

    if (!name || !messageType) {
      return res.status(400).json({
        success: false,
        error: 'Campaign name and message type are required'
      });
    }

    // Validate template exists and matches message type
    if (templateId) {
      const templateResult = await query(
        'SELECT type FROM message_templates WHERE id = $1 AND is_active = true',
        [templateId]
      );
      
      if (templateResult.rows.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Template not found or inactive'
        });
      }
      
      if (templateResult.rows[0].type !== messageType) {
        return res.status(400).json({
          success: false,
          error: 'Template type does not match campaign message type'
        });
      }
    }

    const result = await query(`
      INSERT INTO campaigns (
        name, description, message_type, template_id, target_states, 
        target_business_types, target_industries, min_registration_date, 
        max_registration_date, daily_limit, hourly_limit, start_date, end_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [
      name, description, messageType, templateId, targetStates,
      targetBusinessTypes, targetIndustries, minRegistrationDate,
      maxRegistrationDate, dailyLimit, hourlyLimit, startDate, endDate
    ]);

    logger.info('Campaign created', { campaignId: result.rows[0].id, name });

    res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (err) {
    logger.error('Failed to create campaign', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Update campaign
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Build dynamic update query
    const allowedFields = [
      'name', 'description', 'template_id', 'target_states', 'target_business_types',
      'target_industries', 'min_registration_date', 'max_registration_date',
      'daily_limit', 'hourly_limit', 'start_date', 'end_date', 'is_active'
    ];
    
    const updateFields = [];
    const values = [];
    let paramIndex = 1;

    Object.keys(updates).forEach(field => {
      if (allowedFields.includes(field)) {
        updateFields.push(`${field} = $${paramIndex++}`);
        values.push(updates[field]);
      }
    });

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields to update'
      });
    }

    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const updateQuery = `
      UPDATE campaigns 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await query(updateQuery, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Campaign not found'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (err) {
    logger.error('Failed to update campaign', { campaignId: req.params.id, error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Delete campaign
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await query('DELETE FROM campaigns WHERE id = $1 RETURNING id', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Campaign not found'
      });
    }

    res.json({
      success: true,
      message: 'Campaign deleted successfully'
    });

  } catch (err) {
    logger.error('Failed to delete campaign', { campaignId: req.params.id, error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Preview campaign targets
router.post('/:id/preview', async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 10 } = req.body;
    
    const result = await leadFiltering.getLeadsForCampaign(id, limit);
    
    res.json({
      success: true,
      data: {
        totalTargeted: result.pagination.total,
        sampleLeads: result.leads,
        pagination: result.pagination
      }
    });

  } catch (err) {
    logger.error('Failed to preview campaign', { campaignId: req.params.id, error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Generate messages for campaign
router.post('/:id/generate-messages', async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 100, dryRun = false } = req.body;
    
    const leadsResult = await leadFiltering.getLeadsForCampaign(id, limit);
    const leads = leadsResult.leads;

    if (leads.length === 0) {
      return res.json({
        success: true,
        data: {
          message: 'No leads found for this campaign',
          generated: 0,
          leads: []
        }
      });
    }

    let generatedCount = 0;
    const results = [];

    if (!dryRun) {
      // Generate messages in transaction
      await transaction(async (client) => {
        for (const lead of leads) {
          try {
            const messageData = await messageGeneration.createCampaignMessage(lead.id, id);
            results.push({
              leadId: lead.id,
              messageId: messageData.messageId,
              companyName: lead.company_name,
              success: true
            });
            generatedCount++;
          } catch (err) {
            logger.error('Failed to generate message for lead', { 
              leadId: lead.id, 
              campaignId: id, 
              error: err.message 
            });
            results.push({
              leadId: lead.id,
              companyName: lead.company_name,
              success: false,
              error: err.message
            });
          }
        }

        // Update campaign statistics
        await client.query(`
          UPDATE campaigns 
          SET total_targeted = total_targeted + $1,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
        `, [generatedCount, id]);
      });
    } else {
      // Dry run - just return what would be generated
      generatedCount = leads.length;
      leads.forEach(lead => {
        results.push({
          leadId: lead.id,
          companyName: lead.company_name,
          success: true,
          dryRun: true
        });
      });
    }

    res.json({
      success: true,
      data: {
        generated: generatedCount,
        total: leads.length,
        dryRun,
        results: results.slice(0, 20) // Limit response size
      }
    });

  } catch (err) {
    logger.error('Failed to generate campaign messages', { campaignId: req.params.id, error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Start campaign (activate and begin sending)
router.post('/:id/start', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Activate campaign
    const result = await query(`
      UPDATE campaigns 
      SET is_active = true, 
          start_date = COALESCE(start_date, CURRENT_DATE),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Campaign not found'
      });
    }

    logger.info('Campaign started', { campaignId: id });

    res.json({
      success: true,
      data: result.rows[0],
      message: 'Campaign started successfully'
    });

  } catch (err) {
    logger.error('Failed to start campaign', { campaignId: req.params.id, error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Stop campaign
router.post('/:id/stop', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await query(`
      UPDATE campaigns 
      SET is_active = false,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Campaign not found'
      });
    }

    // Cancel pending messages for this campaign
    await query(`
      UPDATE messages 
      SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
      WHERE campaign_id = $1 AND status = 'pending'
    `, [id]);

    logger.info('Campaign stopped', { campaignId: id });

    res.json({
      success: true,
      data: result.rows[0],
      message: 'Campaign stopped successfully'
    });

  } catch (err) {
    logger.error('Failed to stop campaign', { campaignId: req.params.id, error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get campaign performance metrics
router.get('/:id/metrics', async (req, res) => {
  try {
    const { id } = req.params;
    const { days = 30 } = req.query;
    
    // Get detailed campaign metrics
    const metricsResult = await query(`
      SELECT 
        DATE_TRUNC('day', m.created_at) as date,
        m.status,
        COUNT(*) as count,
        AVG(CASE WHEN m.delivered_at IS NOT NULL AND m.sent_at IS NOT NULL 
            THEN EXTRACT(EPOCH FROM (m.delivered_at - m.sent_at)) 
            ELSE NULL END) as avg_delivery_time_seconds
      FROM messages m
      WHERE m.campaign_id = $1 
        AND m.created_at >= CURRENT_DATE - INTERVAL '${days} days'
      GROUP BY DATE_TRUNC('day', m.created_at), m.status
      ORDER BY date DESC, m.status
    `, [id]);

    // Get overall campaign stats
    const overallResult = await query(`
      SELECT 
        COUNT(*) as total_messages,
        COUNT(CASE WHEN status = 'sent' THEN 1 END) as sent_count,
        COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered_count,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
        COUNT(CASE WHEN status = 'opted_out' THEN 1 END) as opted_out_count,
        ROUND(
          COUNT(CASE WHEN status = 'delivered' THEN 1 END) * 100.0 / 
          NULLIF(COUNT(CASE WHEN status IN ('sent', 'delivered', 'failed') THEN 1 END), 0), 
          2
        ) as delivery_rate
      FROM messages 
      WHERE campaign_id = $1
    `, [id]);

    res.json({
      success: true,
      data: {
        overall: overallResult.rows[0],
        daily: metricsResult.rows
      }
    });

  } catch (err) {
    logger.error('Failed to get campaign metrics', { campaignId: req.params.id, error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

module.exports = router;
