const express = require('express');
const MessageGenerationService = require('../services/messageGeneration');
const SMSService = require('../services/smsService');
const EmailService = require('../services/emailService');
const { query, logger } = require('../database/connection');

const router = express.Router();
const messageGeneration = new MessageGenerationService();

// Lazy-load services to avoid initialization errors
let smsService = null;
let emailService = null;

const getSMSService = () => {
  if (!smsService) smsService = new SMSService();
  return smsService;
};

const getEmailService = () => {
  if (!emailService) emailService = new EmailService();
  return emailService;
};

// Get messages with filtering and pagination
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      messageType,
      status,
      campaignId,
      leadId,
      orderBy = 'created_at',
      orderDirection = 'DESC'
    } = req.query;

    let whereConditions = [];
    let params = [];
    let paramIndex = 1;

    if (messageType) {
      whereConditions.push(`message_type = $${paramIndex++}`);
      params.push(messageType);
    }

    if (status) {
      const statuses = status.split(',');
      const statusPlaceholders = statuses.map(() => `$${paramIndex++}`).join(',');
      whereConditions.push(`status IN (${statusPlaceholders})`);
      params.push(...statuses);
    }

    if (campaignId) {
      whereConditions.push(`campaign_id = $${paramIndex++}`);
      params.push(campaignId);
    }

    if (leadId) {
      whereConditions.push(`lead_id = $${paramIndex++}`);
      params.push(leadId);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Validate orderBy to prevent SQL injection
    const allowedOrderBy = ['created_at', 'sent_at', 'status', 'message_type'];
    const safeOrderBy = allowedOrderBy.includes(orderBy) ? orderBy : 'created_at';
    const safeDirection = orderDirection.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const messagesQuery = `
      SELECT 
        m.*,
        l.company_name,
        l.state
      FROM messages m
      LEFT JOIN leads l ON m.lead_id = l.id
      ${whereClause}
      ORDER BY m.${safeOrderBy} ${safeDirection}
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

    params.push(parseInt(limit), offset);

    const result = await query(messagesQuery, params);

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM messages m
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
    logger.error('Failed to get messages', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get single message by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await query(`
      SELECT 
        m.*,
        l.company_name,
        l.state,
        l.phone,
        l.email
      FROM messages m
      LEFT JOIN leads l ON m.lead_id = l.id
      WHERE m.id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Message not found'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (err) {
    logger.error('Failed to get message', { messageId: req.params.id, error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Generate message for lead
router.post('/generate', async (req, res) => {
  try {
    const { leadId, templateName, additionalData = {} } = req.body;

    if (!leadId || !templateName) {
      return res.status(400).json({
        success: false,
        error: 'Lead ID and template name are required'
      });
    }

    const messageData = await messageGeneration.generateMessage(leadId, templateName, additionalData);
    
    res.json({
      success: true,
      data: messageData
    });

  } catch (err) {
    logger.error('Failed to generate message', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Create and queue message
router.post('/create', async (req, res) => {
  try {
    const { leadId, templateName, campaignId, additionalData = {} } = req.body;

    if (!leadId || !templateName) {
      return res.status(400).json({
        success: false,
        error: 'Lead ID and template name are required'
      });
    }

    let messageData;
    
    if (campaignId) {
      messageData = await messageGeneration.createCampaignMessage(leadId, campaignId, templateName);
    } else {
      // Generate message and store it
      const generated = await messageGeneration.generateMessage(leadId, templateName, additionalData);
      
      const insertResult = await query(`
        INSERT INTO messages (
          lead_id, message_type, template_name, recipient_phone, recipient_email,
          subject, content, personalized_data, affiliate_links, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
        RETURNING id
      `, [
        leadId,
        generated.messageType,
        generated.templateName,
        generated.messageType === 'sms' ? generated.recipient.contact : null,
        generated.messageType === 'email' ? generated.recipient.contact : null,
        generated.subject,
        generated.content,
        JSON.stringify(generated.personalizedData),
        JSON.stringify(generated.affiliateLinks)
      ]);

      messageData = {
        messageId: insertResult.rows[0].id,
        ...generated
      };
    }
    
    res.json({
      success: true,
      data: messageData
    });

  } catch (err) {
    logger.error('Failed to create message', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Send single message
router.post('/:id/send', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get message details
    const messageResult = await query('SELECT * FROM messages WHERE id = $1', [id]);
    if (messageResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Message not found'
      });
    }

    const message = messageResult.rows[0];
    let result;

    if (message.message_type === 'sms') {
      result = await getSMSService().sendSMS(id);
    } else if (message.message_type === 'email') {
      result = await getEmailService().sendEmail(id);
    } else {
      return res.status(400).json({
        success: false,
        error: 'Invalid message type'
      });
    }
    
    res.json({
      success: result.success,
      data: result
    });

  } catch (err) {
    logger.error('Failed to send message', { messageId: req.params.id, error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Send bulk messages
router.post('/send-bulk', async (req, res) => {
  try {
    const { messageIds, messageType, options = {} } = req.body;

    if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Message IDs array is required'
      });
    }

    let result;

    if (messageType === 'sms') {
      result = await getSMSService().sendBulkSMS(messageIds, options);
    } else if (messageType === 'email') {
      result = await getEmailService().sendBulkEmail(messageIds, options);
    } else {
      return res.status(400).json({
        success: false,
        error: 'Valid message type (sms or email) is required'
      });
    }
    
    res.json({
      success: true,
      data: result
    });

  } catch (err) {
    logger.error('Failed to send bulk messages', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Check delivery status
router.get('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    
    const messageResult = await query('SELECT message_type FROM messages WHERE id = $1', [id]);
    if (messageResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Message not found'
      });
    }

    const messageType = messageResult.rows[0].message_type;
    let result;

    if (messageType === 'sms') {
      result = await getSMSService().checkDeliveryStatus(id);
    } else {
      // For email, just return current status from database
      const statusResult = await query(`
        SELECT status, sent_at, delivered_at, failed_at, failure_reason
        FROM messages WHERE id = $1
      `, [id]);
      
      result = {
        messageId: id,
        ...statusResult.rows[0]
      };
    }
    
    res.json({
      success: true,
      data: result
    });

  } catch (err) {
    logger.error('Failed to check message status', { messageId: req.params.id, error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Update message status
router.put('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, failureReason } = req.body;

    const allowedStatuses = ['pending', 'sent', 'delivered', 'failed', 'bounced', 'opted_out'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status'
      });
    }

    let updateQuery = `
      UPDATE messages 
      SET status = $1, updated_at = CURRENT_TIMESTAMP
    `;
    let params = [status];
    let paramIndex = 2;

    if (status === 'failed' && failureReason) {
      updateQuery += `, failure_reason = $${paramIndex++}, failed_at = CURRENT_TIMESTAMP`;
      params.push(failureReason);
    } else if (status === 'delivered') {
      updateQuery += `, delivered_at = CURRENT_TIMESTAMP`;
    }

    updateQuery += ` WHERE id = $${paramIndex} RETURNING *`;
    params.push(id);

    const result = await query(updateQuery, params);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Message not found'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (err) {
    logger.error('Failed to update message status', { messageId: req.params.id, error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Delete message
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await query('DELETE FROM messages WHERE id = $1 RETURNING id', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Message not found'
      });
    }

    res.json({
      success: true,
      message: 'Message deleted successfully'
    });

  } catch (err) {
    logger.error('Failed to delete message', { messageId: req.params.id, error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get message templates
router.get('/templates', async (req, res) => {
  try {
    const { type } = req.query;
    
    let whereClause = 'WHERE is_active = true';
    const params = [];
    
    if (type) {
      whereClause += ' AND type = $1';
      params.push(type);
    }
    
    const result = await query(`
      SELECT * FROM message_templates 
      ${whereClause}
      ORDER BY name
    `, params);
    
    res.json({
      success: true,
      data: result.rows
    });

  } catch (err) {
    logger.error('Failed to get message templates', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get message statistics
router.get('/stats/overview', async (req, res) => {
  try {
    const { days = 30, campaignId } = req.query;
    
    const smsStats = await getSMSService().getSMSStats(parseInt(days));
    const emailStats = await getEmailService().getEmailStats(parseInt(days));
    
    res.json({
      success: true,
      data: {
        sms: smsStats,
        email: emailStats
      }
    });

  } catch (err) {
    logger.error('Failed to get message stats', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

module.exports = router;
