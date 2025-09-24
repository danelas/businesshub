const TextMagic = require('textmagic-rest-nodejs');
const { query, logger } = require('../database/connection');

class SMSService {
  constructor() {
    this.client = new TextMagic.TextmagicRestClient(
      process.env.TEXTMAGIC_USERNAME,
      process.env.TEXTMAGIC_API_KEY
    );
    this.fromPhone = process.env.FROM_PHONE;
    this.maxRetries = 3;
    this.retryDelay = 5000; // 5 seconds
  }

  // Send SMS message
  async sendSMS(messageId) {
    try {
      // Get message details
      const messageResult = await query('SELECT * FROM messages WHERE id = $1', [messageId]);
      if (messageResult.rows.length === 0) {
        throw new Error('Message not found');
      }
      
      const message = messageResult.rows[0];
      
      if (message.message_type !== 'sms') {
        throw new Error('Message is not SMS type');
      }
      
      if (!message.recipient_phone) {
        throw new Error('No recipient phone number');
      }

      // Update message status to sending
      await query(`
        UPDATE messages 
        SET status = 'sending', updated_at = CURRENT_TIMESTAMP 
        WHERE id = $1
      `, [messageId]);

      logger.info('Sending SMS', { messageId, phone: message.recipient_phone });

      // Send via TextMagic
      const response = await this.sendWithRetry({
        text: message.content,
        phones: message.recipient_phone,
        from: this.fromPhone
      });

      // Update message with success
      await query(`
        UPDATE messages 
        SET status = 'sent', 
            sent_at = CURRENT_TIMESTAMP,
            provider_message_id = $1,
            provider_status = $2,
            provider_response = $3,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $4
      `, [
        response.id,
        response.status,
        JSON.stringify(response),
        messageId
      ]);

      logger.info('SMS sent successfully', { 
        messageId, 
        providerMessageId: response.id,
        phone: message.recipient_phone 
      });

      return {
        success: true,
        messageId,
        providerMessageId: response.id,
        status: 'sent'
      };

    } catch (err) {
      logger.error('SMS sending failed', { messageId, error: err.message });
      
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

  // Send SMS with retry logic
  async sendWithRetry(smsData, attempt = 1) {
    try {
      return await new Promise((resolve, reject) => {
        this.client.Messages.send(smsData, (err, res) => {
          if (err) {
            reject(new Error(err.message || 'TextMagic API error'));
          } else {
            resolve(res);
          }
        });
      });
    } catch (err) {
      if (attempt < this.maxRetries) {
        logger.warn(`SMS send attempt ${attempt} failed, retrying...`, { error: err.message });
        await this.delay(this.retryDelay * attempt);
        return this.sendWithRetry(smsData, attempt + 1);
      }
      throw err;
    }
  }

  // Send bulk SMS messages
  async sendBulkSMS(messageIds, options = {}) {
    const { batchSize = 10, delayBetweenBatches = 1000 } = options;
    const results = [];
    
    logger.info('Starting bulk SMS send', { messageCount: messageIds.length, batchSize });

    // Process in batches to respect rate limits
    for (let i = 0; i < messageIds.length; i += batchSize) {
      const batch = messageIds.slice(i, i + batchSize);
      const batchResults = [];

      // Send batch concurrently
      const promises = batch.map(messageId => this.sendSMS(messageId));
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

    logger.info('Bulk SMS send completed', { 
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

  // Check delivery status
  async checkDeliveryStatus(messageId) {
    try {
      const messageResult = await query(`
        SELECT provider_message_id FROM messages 
        WHERE id = $1 AND message_type = 'sms'
      `, [messageId]);

      if (messageResult.rows.length === 0) {
        throw new Error('SMS message not found');
      }

      const providerMessageId = messageResult.rows[0].provider_message_id;
      if (!providerMessageId) {
        return { status: 'pending', message: 'No provider message ID' };
      }

      // Check status with TextMagic
      const status = await new Promise((resolve, reject) => {
        this.client.Messages.get(providerMessageId, (err, res) => {
          if (err) {
            reject(new Error(err.message || 'TextMagic API error'));
          } else {
            resolve(res);
          }
        });
      });

      // Update message status if changed
      const newStatus = this.mapProviderStatus(status.status);
      if (newStatus) {
        await query(`
          UPDATE messages 
          SET status = $1, 
              provider_status = $2,
              delivered_at = CASE WHEN $1 = 'delivered' THEN CURRENT_TIMESTAMP ELSE delivered_at END,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $3
        `, [newStatus, status.status, messageId]);
      }

      return {
        messageId,
        status: newStatus || status.status,
        providerStatus: status.status,
        deliveredAt: status.deliveredAt
      };

    } catch (err) {
      logger.error('Failed to check SMS delivery status', { messageId, error: err.message });
      return { messageId, status: 'unknown', error: err.message };
    }
  }

  // Map TextMagic status to our internal status
  mapProviderStatus(providerStatus) {
    const statusMap = {
      'q': 'pending',      // queued
      's': 'sent',         // sent
      'd': 'delivered',    // delivered
      'f': 'failed',       // failed
      'a': 'delivered',    // accepted
      'r': 'failed'        // rejected
    };
    
    return statusMap[providerStatus] || null;
  }

  // Handle opt-out requests
  async handleOptOut(phone, leadId = null) {
    try {
      // Record opt-out
      await query(`
        INSERT INTO opt_outs (phone, lead_id, opt_out_type, source)
        VALUES ($1, $2, 'sms', 'reply')
        ON CONFLICT (phone) DO UPDATE SET
          opted_out_at = CURRENT_TIMESTAMP,
          source = 'reply'
      `, [phone, leadId]);

      // Update any pending SMS messages for this phone
      await query(`
        UPDATE messages 
        SET status = 'opted_out', updated_at = CURRENT_TIMESTAMP
        WHERE recipient_phone = $1 AND status = 'pending'
      `, [phone]);

      logger.info('SMS opt-out processed', { phone, leadId });
      
      return { success: true, phone, message: 'Opt-out processed' };
    } catch (err) {
      logger.error('Failed to process SMS opt-out', { phone, leadId, error: err.message });
      throw err;
    }
  }

  // Get SMS statistics
  async getSMSStats(days = 30) {
    const result = await query(`
      SELECT 
        DATE_TRUNC('day', sent_at) as date,
        status,
        COUNT(*) as count,
        AVG(EXTRACT(EPOCH FROM (delivered_at - sent_at))) as avg_delivery_time_seconds
      FROM messages 
      WHERE message_type = 'sms' 
        AND sent_at >= CURRENT_DATE - INTERVAL '${days} days'
      GROUP BY DATE_TRUNC('day', sent_at), status
      ORDER BY date DESC, status
    `);

    return result.rows;
  }

  // Check account balance
  async checkBalance() {
    try {
      const balance = await new Promise((resolve, reject) => {
        this.client.User.get((err, res) => {
          if (err) {
            reject(new Error(err.message || 'TextMagic API error'));
          } else {
            resolve(res.balance);
          }
        });
      });

      logger.info('TextMagic balance checked', { balance });
      return { balance, currency: 'USD' };
    } catch (err) {
      logger.error('Failed to check TextMagic balance', { error: err.message });
      throw err;
    }
  }

  // Utility function for delays
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Validate phone number format
  validatePhoneNumber(phone) {
    // Basic validation - adjust based on your requirements
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    return phoneRegex.test(phone.replace(/[\s\-\(\)]/g, ''));
  }
}

module.exports = SMSService;
