const express = require('express');
const EmailService = require('../services/emailService');
const SMSService = require('../services/smsService');
const { query, logger } = require('../database/connection');

const router = express.Router();

// Lazy-load services to avoid initialization errors
let emailService = null;
let smsService = null;

const getEmailService = () => {
  if (!emailService) emailService = new EmailService();
  return emailService;
};

const getSMSService = () => {
  if (!smsService) smsService = new SMSService();
  return smsService;
};

// SendGrid webhook endpoint
router.post('/sendgrid', async (req, res) => {
  try {
    const events = req.body;
    
    if (!Array.isArray(events)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid webhook payload'
      });
    }

    logger.info('Received SendGrid webhook', { eventCount: events.length });

    const results = await getEmailService().handleWebhook(events);
    
    res.json({
      success: true,
      processed: results.length,
      results: results.filter(r => !r.processed) // Only return failed ones
    });

  } catch (err) {
    logger.error('SendGrid webhook processing failed', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// TextMagic webhook endpoint (for delivery receipts)
router.post('/textmagic', async (req, res) => {
  try {
    const { id, status, phone, timestamp } = req.body;
    
    if (!id || !status) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    logger.info('Received TextMagic webhook', { messageId: id, status, phone });

    // Find message by provider message ID
    const messageResult = await query(`
      SELECT id FROM messages 
      WHERE provider_message_id = $1 AND message_type = 'sms'
    `, [id]);

    if (messageResult.rows.length === 0) {
      logger.warn('TextMagic webhook for unknown message', { providerId: id });
      return res.json({ success: true, message: 'Message not found' });
    }

    const messageId = messageResult.rows[0].id;
    const newStatus = getSMSService().mapProviderStatus(status);
    
    if (newStatus) {
      await query(`
        UPDATE messages 
        SET status = $1,
            provider_status = $2,
            delivered_at = CASE WHEN $1 = 'delivered' THEN to_timestamp($3) ELSE delivered_at END,
            failed_at = CASE WHEN $1 = 'failed' THEN to_timestamp($3) ELSE failed_at END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $4
      `, [newStatus, status, timestamp, messageId]);

      logger.info('SMS status updated from webhook', { messageId, status: newStatus });
    }

    res.json({ success: true });

  } catch (err) {
    logger.error('TextMagic webhook processing failed', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Generic unsubscribe endpoint
router.post('/unsubscribe', async (req, res) => {
  try {
    const { lead, type = 'all', phone, email } = req.body;
    
    let leadData = null;
    
    // Get lead information if lead ID provided
    if (lead) {
      const leadResult = await query('SELECT * FROM leads WHERE id = $1', [lead]);
      if (leadResult.rows.length > 0) {
        leadData = leadResult.rows[0];
      }
    }

    // Process opt-out based on type
    if (type === 'sms' || type === 'all') {
      const phoneToOptOut = phone || (leadData && leadData.phone);
      if (phoneToOptOut) {
        await getSMSService().handleOptOut(phoneToOptOut, lead);
      }
    }

    if (type === 'email' || type === 'all') {
      const emailToOptOut = email || (leadData && leadData.email);
      if (emailToOptOut) {
        await getEmailService().handleOptOut(emailToOptOut, lead);
      }
    }

    logger.info('Unsubscribe processed', { lead, type, phone, email });

    res.json({
      success: true,
      message: 'Unsubscribe request processed successfully'
    });

  } catch (err) {
    logger.error('Unsubscribe processing failed', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Handle SMS replies (if using a service that supports this)
router.post('/sms-reply', async (req, res) => {
  try {
    const { from, to, text, messageId } = req.body;
    
    if (!from || !text) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    logger.info('Received SMS reply', { from, text: text.substring(0, 50) });

    // Check for opt-out keywords
    const optOutKeywords = ['STOP', 'UNSUBSCRIBE', 'QUIT', 'CANCEL', 'END'];
    const normalizedText = text.toUpperCase().trim();
    
    if (optOutKeywords.some(keyword => normalizedText.includes(keyword))) {
      // Find lead by phone number
      const leadResult = await query('SELECT id FROM leads WHERE phone = $1', [from]);
      const leadId = leadResult.rows.length > 0 ? leadResult.rows[0].id : null;
      
      await getSMSService().handleOptOut(from, leadId);
      
      // Log the reply
      await query(`
        INSERT INTO opt_outs (phone, lead_id, opt_out_type, source)
        VALUES ($1, $2, 'sms', 'reply')
        ON CONFLICT (phone) DO UPDATE SET
          opted_out_at = CURRENT_TIMESTAMP,
          source = 'reply'
      `, [from, leadId]);
      
      logger.info('SMS opt-out processed from reply', { from, leadId });
    } else {
      // Log non-opt-out replies for analysis
      logger.info('SMS reply received (not opt-out)', { from, text });
    }

    res.json({ success: true });

  } catch (err) {
    logger.error('SMS reply processing failed', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Webhook for email bounces and complaints
router.post('/email-bounce', async (req, res) => {
  try {
    const { email, bounceType, reason, messageId } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email address is required'
      });
    }

    logger.info('Email bounce received', { email, bounceType, reason });

    // Mark email as bounced and potentially opt out
    if (bounceType === 'hard' || bounceType === 'permanent') {
      // Find lead by email
      const leadResult = await query('SELECT id FROM leads WHERE email = $1', [email]);
      const leadId = leadResult.rows.length > 0 ? leadResult.rows[0].id : null;
      
      // Add to opt-outs for hard bounces
      await query(`
        INSERT INTO opt_outs (email, lead_id, opt_out_type, source)
        VALUES ($1, $2, 'email', 'bounce')
        ON CONFLICT (email) DO UPDATE SET
          opted_out_at = CURRENT_TIMESTAMP,
          source = 'bounce'
      `, [email, leadId]);
      
      // Update any pending messages
      await query(`
        UPDATE messages 
        SET status = 'failed', 
            failure_reason = $1,
            failed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE recipient_email = $2 AND status IN ('pending', 'sent')
      `, [`Hard bounce: ${reason}`, email]);
      
      logger.info('Hard bounce processed - email opted out', { email, leadId });
    }

    res.json({ success: true });

  } catch (err) {
    logger.error('Email bounce processing failed', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get opt-out statistics
router.get('/opt-outs/stats', async (req, res) => {
  try {
    const { days = 30 } = req.query;
    
    const result = await query(`
      SELECT 
        opt_out_type,
        source,
        DATE_TRUNC('day', opted_out_at) as date,
        COUNT(*) as count
      FROM opt_outs 
      WHERE opted_out_at >= CURRENT_DATE - INTERVAL '${days} days'
      GROUP BY opt_out_type, source, DATE_TRUNC('day', opted_out_at)
      ORDER BY date DESC, opt_out_type, source
    `);

    // Get total opt-outs by type
    const totalResult = await query(`
      SELECT 
        opt_out_type,
        COUNT(*) as total
      FROM opt_outs
      GROUP BY opt_out_type
    `);

    res.json({
      success: true,
      data: {
        daily: result.rows,
        totals: totalResult.rows
      }
    });

  } catch (err) {
    logger.error('Failed to get opt-out stats', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get recent opt-outs
router.get('/opt-outs/recent', async (req, res) => {
  try {
    const { limit = 50, type } = req.query;
    
    let whereClause = '';
    const params = [];
    
    if (type) {
      whereClause = 'WHERE opt_out_type = $1';
      params.push(type);
    }
    
    const result = await query(`
      SELECT 
        o.*,
        l.company_name,
        l.state
      FROM opt_outs o
      LEFT JOIN leads l ON o.lead_id = l.id
      ${whereClause}
      ORDER BY o.opted_out_at DESC
      LIMIT $${params.length + 1}
    `, [...params, parseInt(limit)]);

    res.json({
      success: true,
      data: result.rows
    });

  } catch (err) {
    logger.error('Failed to get recent opt-outs', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Manual opt-out endpoint
router.post('/opt-out/manual', async (req, res) => {
  try {
    const { leadId, phone, email, type = 'all', reason } = req.body;
    
    if (!leadId && !phone && !email) {
      return res.status(400).json({
        success: false,
        error: 'Lead ID, phone, or email is required'
      });
    }

    const results = [];

    if ((type === 'sms' || type === 'all') && (phone || leadId)) {
      let phoneToOptOut = phone;
      
      if (!phoneToOptOut && leadId) {
        const leadResult = await query('SELECT phone FROM leads WHERE id = $1', [leadId]);
        if (leadResult.rows.length > 0) {
          phoneToOptOut = leadResult.rows[0].phone;
        }
      }
      
      if (phoneToOptOut) {
        const result = await getSMSService().handleOptOut(phoneToOptOut, leadId);
        results.push({ type: 'sms', ...result });
      }
    }

    if ((type === 'email' || type === 'all') && (email || leadId)) {
      let emailToOptOut = email;
      
      if (!emailToOptOut && leadId) {
        const leadResult = await query('SELECT email FROM leads WHERE id = $1', [leadId]);
        if (leadResult.rows.length > 0) {
          emailToOptOut = leadResult.rows[0].email;
        }
      }
      
      if (emailToOptOut) {
        const result = await getEmailService().handleOptOut(emailToOptOut, leadId);
        results.push({ type: 'email', ...result });
      }
    }

    res.json({
      success: true,
      data: results,
      message: 'Manual opt-out processed'
    });

  } catch (err) {
    logger.error('Manual opt-out failed', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

module.exports = router;
