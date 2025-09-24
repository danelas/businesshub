const sgMail = require('@sendgrid/mail');
const { query, logger } = require('../database/connection');

class EmailService {
  constructor() {
    this.apiKey = process.env.SENDGRID_API_KEY;
    if (this.apiKey && this.apiKey.startsWith('SG.')) {
      sgMail.setApiKey(this.apiKey);
    } else {
      console.warn('SendGrid API key not configured or invalid. Email functionality will be disabled.');
    }
    this.fromEmail = process.env.FROM_EMAIL || 'noreply@yourdomain.com';
    this.maxRetries = 3;
    this.retryDelay = 5000; // 5 seconds
  }

  // Send email message
  async sendEmail(messageId) {
    try {
      // Check if SendGrid is configured
      if (!this.apiKey || !this.apiKey.startsWith('SG.')) {
        throw new Error('SendGrid API key not configured. Email functionality is disabled.');
      }

      // Get message details
      const messageResult = await query('SELECT * FROM messages WHERE id = $1', [messageId]);
      if (messageResult.rows.length === 0) {
        throw new Error('Message not found');
      }
      
      const message = messageResult.rows[0];
      
      if (message.message_type !== 'email') {
        throw new Error('Message is not email type');
      }
      
      if (!message.recipient_email) {
        throw new Error('No recipient email address');
      }

      if (!message.subject) {
        throw new Error('Email subject is required');
      }

      // Update message status to sending
      await query(`
        UPDATE messages 
        SET status = 'sending', updated_at = CURRENT_TIMESTAMP 
        WHERE id = $1
      `, [messageId]);

      logger.info('Sending email', { messageId, email: message.recipient_email });

      // Prepare email data
      const emailData = {
        to: message.recipient_email,
        from: {
          email: this.fromEmail,
          name: 'LLC Business Resources'
        },
        subject: message.subject,
        html: this.formatEmailContent(message.content),
        text: this.stripHtml(message.content),
        trackingSettings: {
          clickTracking: { enable: true },
          openTracking: { enable: true }
        },
        customArgs: {
          message_id: messageId,
          lead_id: message.lead_id,
          campaign_id: message.campaign_id || ''
        }
      };

      // Send via SendGrid
      const response = await this.sendWithRetry(emailData);

      // Update message with success
      await query(`
        UPDATE messages 
        SET status = 'sent', 
            sent_at = CURRENT_TIMESTAMP,
            provider_message_id = $1,
            provider_status = 'sent',
            provider_response = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
      `, [
        response[0].headers['x-message-id'],
        JSON.stringify(response[0]),
        messageId
      ]);

      logger.info('Email sent successfully', { 
        messageId, 
        providerMessageId: response[0].headers['x-message-id'],
        email: message.recipient_email 
      });

      return {
        success: true,
        messageId,
        providerMessageId: response[0].headers['x-message-id'],
        status: 'sent'
      };

    } catch (err) {
      logger.error('Email sending failed', { messageId, error: err.message });
      
      // Update message with failure
      await query(`
        UPDATE messages 
        SET status = 'failed',
            failed_at = CURRENT_TIMESTAMP,
            failure_reason = $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [err.message, messageId]);

      return {
        success: false,
        messageId,
        error: err.message,
        status: 'failed'
      };
    }
  }

  // Send email with retry logic
  async sendWithRetry(emailData, attempt = 1) {
    try {
      return await sgMail.send(emailData);
    } catch (err) {
      if (attempt < this.maxRetries && this.isRetryableError(err)) {
        logger.warn(`Email send attempt ${attempt} failed, retrying...`, { error: err.message });
        await this.delay(this.retryDelay * attempt);
        return this.sendWithRetry(emailData, attempt + 1);
      }
      
      // Handle SendGrid specific errors
      if (err.response && err.response.body) {
        throw new Error(`SendGrid error: ${JSON.stringify(err.response.body)}`);
      }
      
      throw err;
    }
  }

  // Check if error is retryable
  isRetryableError(err) {
    if (!err.code) return false;
    
    // Retry on rate limits and temporary server errors
    const retryableCodes = [429, 500, 502, 503, 504];
    return retryableCodes.includes(err.code);
  }

  // Send bulk emails
  async sendBulkEmail(messageIds, options = {}) {
    const { batchSize = 10, delayBetweenBatches = 1000 } = options;
    const results = [];
    
    logger.info('Starting bulk email send', { messageCount: messageIds.length, batchSize });

    // Process in batches to respect rate limits
    for (let i = 0; i < messageIds.length; i += batchSize) {
      const batch = messageIds.slice(i, i + batchSize);
      const batchResults = [];

      // Send batch concurrently
      const promises = batch.map(messageId => this.sendEmail(messageId));
      const batchResponses = await Promise.allSettled(promises);

      batchResponses.forEach((response, index) => {
        const messageId = batch[index];
        if (response.status === 'fulfilled') {
          batchResults.push(response.value);
        } else {
          batchResults.push({
            success: false,
            messageId,
            error: response.reason.message,
            status: 'failed'
          });
        }
      });

      results.push(...batchResults);

      // Delay between batches
      if (i + batchSize < messageIds.length) {
        await this.delay(delayBetweenBatches);
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    logger.info('Bulk email send completed', { 
      total: messageIds.length, 
      success: successCount, 
      failed: failureCount 
    });

    return {
      total: messageIds.length,
      success: successCount,
      failed: failureCount,
      results
    };
  }

  // Format email content as HTML
  formatEmailContent(content) {
    // Convert plain text to HTML with basic formatting
    let html = content
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
      .replace(/^/, '<p>')
      .replace(/$/, '</p>');

    // Convert URLs to links
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    html = html.replace(urlRegex, '<a href="$1">$1</a>');

    // Basic email template
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>LLC Business Resources</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #f8f9fa; padding: 20px; text-align: center; border-radius: 5px; margin-bottom: 20px; }
          .content { padding: 20px 0; }
          .footer { background-color: #f8f9fa; padding: 15px; text-align: center; border-radius: 5px; margin-top: 20px; font-size: 12px; color: #666; }
          a { color: #007bff; text-decoration: none; }
          a:hover { text-decoration: underline; }
          .button { display: inline-block; padding: 12px 24px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px; margin: 10px 5px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h2>🏢 LLC Business Resources</h2>
        </div>
        <div class="content">
          ${html}
        </div>
        <div class="footer">
          <p>This email was sent to help your new LLC get started successfully.</p>
          <p>If you no longer wish to receive these emails, <a href="{{unsubscribe_link}}">click here to unsubscribe</a>.</p>
        </div>
      </body>
      </html>
    `;
  }

  // Strip HTML tags for plain text version
  stripHtml(html) {
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim();
  }

  // Handle webhook events from SendGrid
  async handleWebhook(events) {
    const results = [];
    
    for (const event of events) {
      try {
        const messageId = event.message_id || event.sg_message_id;
        if (!messageId) continue;

        // Find message by provider message ID
        const messageResult = await query(`
          SELECT id FROM messages 
          WHERE provider_message_id = $1 AND message_type = 'email'
        `, [messageId]);

        if (messageResult.rows.length === 0) {
          logger.warn('Webhook event for unknown message', { messageId, event: event.event });
          continue;
        }

        const dbMessageId = messageResult.rows[0].id;
        const status = this.mapWebhookEventToStatus(event.event);
        
        if (status) {
          await query(`
            UPDATE messages 
            SET status = $1,
                provider_status = $2,
                delivered_at = CASE WHEN $1 = 'delivered' THEN to_timestamp($3) ELSE delivered_at END,
                failed_at = CASE WHEN $1 = 'failed' THEN to_timestamp($3) ELSE failed_at END,
                failure_reason = CASE WHEN $1 = 'failed' THEN $4 ELSE failure_reason END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $5
          `, [
            status,
            event.event,
            event.timestamp,
            event.reason || null,
            dbMessageId
          ]);

          logger.info('Email status updated from webhook', { 
            messageId: dbMessageId, 
            event: event.event, 
            status 
          });
        }

        results.push({ messageId: dbMessageId, event: event.event, processed: true });

      } catch (err) {
        logger.error('Failed to process webhook event', { event, error: err.message });
        results.push({ event, processed: false, error: err.message });
      }
    }

    return results;
  }

  // Map SendGrid webhook events to our status
  mapWebhookEventToStatus(event) {
    const eventMap = {
      'delivered': 'delivered',
      'bounce': 'failed',
      'dropped': 'failed',
      'deferred': 'pending',
      'processed': 'sent',
      'open': 'delivered', // Consider opened as delivered
      'click': 'delivered',
      'unsubscribe': 'opted_out',
      'spamreport': 'failed'
    };
    
    return eventMap[event] || null;
  }

  // Handle opt-out requests
  async handleOptOut(email, leadId = null) {
    try {
      // Record opt-out
      await query(`
        INSERT INTO opt_outs (email, lead_id, opt_out_type, source)
        VALUES ($1, $2, 'email', 'web_form')
        ON CONFLICT (email) DO UPDATE SET
          opted_out_at = CURRENT_TIMESTAMP,
          source = 'web_form'
      `, [email, leadId]);

      // Update any pending email messages for this address
      await query(`
        UPDATE messages 
        SET status = 'opted_out', updated_at = CURRENT_TIMESTAMP
        WHERE recipient_email = $1 AND status = 'pending'
      `, [email]);

      logger.info('Email opt-out processed', { email, leadId });
      
      return { success: true, email, message: 'Opt-out processed' };
    } catch (err) {
      logger.error('Failed to process email opt-out', { email, leadId, error: err.message });
      throw err;
    }
  }

  // Get email statistics
  async getEmailStats(days = 30) {
    const result = await query(`
      SELECT 
        DATE_TRUNC('day', sent_at) as date,
        status,
        COUNT(*) as count,
        AVG(EXTRACT(EPOCH FROM (delivered_at - sent_at))) as avg_delivery_time_seconds
      FROM messages 
      WHERE message_type = 'email' 
        AND sent_at >= CURRENT_DATE - INTERVAL '${days} days'
      GROUP BY DATE_TRUNC('day', sent_at), status
      ORDER BY date DESC, status
    `);

    return result.rows;
  }

  // Validate email address
  validateEmailAddress(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  // Utility function for delays
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = EmailService;
