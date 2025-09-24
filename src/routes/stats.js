const express = require('express');
const { query, logger } = require('../database/connection');

const router = express.Router();

// Get dashboard overview statistics
router.get('/dashboard', async (req, res) => {
  try {
    const { days = 30 } = req.query;
    
    // Total leads
    const leadsResult = await query(`
      SELECT 
        COUNT(*) as total_leads,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_leads,
        COUNT(CASE WHEN import_date >= CURRENT_DATE - INTERVAL '${days} days' THEN 1 END) as recent_leads
      FROM leads
    `);

    // Total messages
    const messagesResult = await query(`
      SELECT 
        COUNT(*) as total_messages,
        COUNT(CASE WHEN status = 'sent' THEN 1 END) as sent_messages,
        COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered_messages,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_messages,
        COUNT(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '${days} days' THEN 1 END) as recent_messages
      FROM messages
    `);

    // Active campaigns
    const campaignsResult = await query(`
      SELECT 
        COUNT(*) as total_campaigns,
        COUNT(CASE WHEN is_active = true THEN 1 END) as active_campaigns
      FROM campaigns
    `);

    // Opt-outs
    const optOutsResult = await query(`
      SELECT 
        COUNT(*) as total_opt_outs,
        COUNT(CASE WHEN opted_out_at >= CURRENT_DATE - INTERVAL '${days} days' THEN 1 END) as recent_opt_outs
      FROM opt_outs
    `);

    // Delivery rates
    const deliveryResult = await query(`
      SELECT 
        message_type,
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered,
        ROUND(
          COUNT(CASE WHEN status = 'delivered' THEN 1 END) * 100.0 / 
          NULLIF(COUNT(CASE WHEN status IN ('sent', 'delivered', 'failed') THEN 1 END), 0), 
          2
        ) as delivery_rate
      FROM messages 
      WHERE created_at >= CURRENT_DATE - INTERVAL '${days} days'
      GROUP BY message_type
    `);

    res.json({
      success: true,
      data: {
        leads: leadsResult.rows[0],
        messages: messagesResult.rows[0],
        campaigns: campaignsResult.rows[0],
        optOuts: optOutsResult.rows[0],
        deliveryRates: deliveryResult.rows,
        period: `${days} days`
      }
    });

  } catch (err) {
    logger.error('Failed to get dashboard stats', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get lead statistics by state
router.get('/leads/by-state', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    
    const result = await query(`
      SELECT 
        state,
        COUNT(*) as total_leads,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_leads,
        COUNT(CASE WHEN phone IS NOT NULL THEN 1 END) as leads_with_phone,
        COUNT(CASE WHEN email IS NOT NULL THEN 1 END) as leads_with_email,
        AVG(CASE WHEN registration_date IS NOT NULL 
            THEN EXTRACT(EPOCH FROM (CURRENT_DATE - registration_date)) / 86400 
            ELSE NULL END) as avg_days_since_registration
      FROM leads 
      GROUP BY state 
      ORDER BY total_leads DESC
      LIMIT $1
    `, [parseInt(limit)]);

    res.json({
      success: true,
      data: result.rows
    });

  } catch (err) {
    logger.error('Failed to get leads by state', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get message performance over time
router.get('/messages/performance', async (req, res) => {
  try {
    const { days = 30, messageType, campaignId } = req.query;
    
    let whereConditions = [`created_at >= CURRENT_DATE - INTERVAL '${days} days'`];
    const params = [];
    let paramIndex = 1;

    if (messageType) {
      whereConditions.push(`message_type = $${paramIndex++}`);
      params.push(messageType);
    }

    if (campaignId) {
      whereConditions.push(`campaign_id = $${paramIndex++}`);
      params.push(campaignId);
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    const result = await query(`
      SELECT 
        DATE_TRUNC('day', created_at) as date,
        message_type,
        status,
        COUNT(*) as count,
        AVG(CASE WHEN delivered_at IS NOT NULL AND sent_at IS NOT NULL 
            THEN EXTRACT(EPOCH FROM (delivered_at - sent_at)) 
            ELSE NULL END) as avg_delivery_time_seconds
      FROM messages 
      ${whereClause}
      GROUP BY DATE_TRUNC('day', created_at), message_type, status
      ORDER BY date DESC, message_type, status
    `, params);

    res.json({
      success: true,
      data: result.rows
    });

  } catch (err) {
    logger.error('Failed to get message performance', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get campaign performance comparison
router.get('/campaigns/performance', async (req, res) => {
  try {
    const { days = 30 } = req.query;
    
    const result = await query(`
      SELECT 
        c.id,
        c.name,
        c.message_type,
        c.created_at,
        COUNT(m.id) as total_messages,
        COUNT(CASE WHEN m.status = 'sent' THEN 1 END) as sent_count,
        COUNT(CASE WHEN m.status = 'delivered' THEN 1 END) as delivered_count,
        COUNT(CASE WHEN m.status = 'failed' THEN 1 END) as failed_count,
        COUNT(CASE WHEN m.status = 'opted_out' THEN 1 END) as opted_out_count,
        ROUND(
          COUNT(CASE WHEN m.status = 'delivered' THEN 1 END) * 100.0 / 
          NULLIF(COUNT(CASE WHEN m.status IN ('sent', 'delivered', 'failed') THEN 1 END), 0), 
          2
        ) as delivery_rate,
        ROUND(
          COUNT(CASE WHEN m.status = 'opted_out' THEN 1 END) * 100.0 / 
          NULLIF(COUNT(m.id), 0), 
          2
        ) as opt_out_rate
      FROM campaigns c
      LEFT JOIN messages m ON c.id = m.campaign_id 
        AND m.created_at >= CURRENT_DATE - INTERVAL '${days} days'
      WHERE c.created_at >= CURRENT_DATE - INTERVAL '${days} days'
      GROUP BY c.id, c.name, c.message_type, c.created_at
      ORDER BY total_messages DESC
    `);

    res.json({
      success: true,
      data: result.rows
    });

  } catch (err) {
    logger.error('Failed to get campaign performance', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get top performing templates
router.get('/templates/performance', async (req, res) => {
  try {
    const { days = 30, messageType } = req.query;
    
    let whereConditions = [`m.created_at >= CURRENT_DATE - INTERVAL '${days} days'`];
    const params = [];
    let paramIndex = 1;

    if (messageType) {
      whereConditions.push(`m.message_type = $${paramIndex++}`);
      params.push(messageType);
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    const result = await query(`
      SELECT 
        m.template_name,
        t.type as template_type,
        COUNT(m.id) as total_messages,
        COUNT(CASE WHEN m.status = 'delivered' THEN 1 END) as delivered_count,
        COUNT(CASE WHEN m.status = 'failed' THEN 1 END) as failed_count,
        COUNT(CASE WHEN m.status = 'opted_out' THEN 1 END) as opted_out_count,
        ROUND(
          COUNT(CASE WHEN m.status = 'delivered' THEN 1 END) * 100.0 / 
          NULLIF(COUNT(CASE WHEN m.status IN ('sent', 'delivered', 'failed') THEN 1 END), 0), 
          2
        ) as delivery_rate,
        ROUND(
          COUNT(CASE WHEN m.status = 'opted_out' THEN 1 END) * 100.0 / 
          NULLIF(COUNT(m.id), 0), 
          2
        ) as opt_out_rate
      FROM messages m
      LEFT JOIN message_templates t ON m.template_name = t.name
      ${whereClause}
      GROUP BY m.template_name, t.type
      HAVING COUNT(m.id) >= 10  -- Only templates with significant usage
      ORDER BY delivery_rate DESC, total_messages DESC
    `, params);

    res.json({
      success: true,
      data: result.rows
    });

  } catch (err) {
    logger.error('Failed to get template performance', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get import statistics
router.get('/imports/summary', async (req, res) => {
  try {
    const { days = 30 } = req.query;
    
    const result = await query(`
      SELECT 
        source,
        COUNT(*) as import_count,
        SUM(total_records) as total_records,
        SUM(new_records) as new_records,
        SUM(duplicate_records) as duplicate_records,
        SUM(error_records) as error_records,
        ROUND(
          SUM(new_records) * 100.0 / NULLIF(SUM(total_records), 0), 
          2
        ) as success_rate,
        MAX(completed_at) as last_import,
        MIN(completed_at) as first_import
      FROM import_logs 
      WHERE completed_at >= CURRENT_DATE - INTERVAL '${days} days'
        AND status = 'completed'
      GROUP BY source
      ORDER BY total_records DESC
    `);

    // Get daily import trends
    const trendsResult = await query(`
      SELECT 
        DATE_TRUNC('day', completed_at) as date,
        source,
        COUNT(*) as import_count,
        SUM(new_records) as new_records
      FROM import_logs 
      WHERE completed_at >= CURRENT_DATE - INTERVAL '${days} days'
        AND status = 'completed'
      GROUP BY DATE_TRUNC('day', completed_at), source
      ORDER BY date DESC, source
    `);

    res.json({
      success: true,
      data: {
        summary: result.rows,
        trends: trendsResult.rows
      }
    });

  } catch (err) {
    logger.error('Failed to get import statistics', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get revenue potential estimates
router.get('/revenue/estimates', async (req, res) => {
  try {
    const { conversionRate = 0.02, averageCommission = 50 } = req.query;
    
    const result = await query(`
      SELECT 
        COUNT(CASE WHEN l.status = 'active' AND (l.phone IS NOT NULL OR l.email IS NOT NULL) THEN 1 END) as contactable_leads,
        COUNT(CASE WHEN m.status = 'delivered' THEN 1 END) as delivered_messages,
        COUNT(CASE WHEN m.status = 'delivered' AND m.created_at >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as recent_delivered,
        COUNT(DISTINCT CASE WHEN m.status = 'delivered' THEN m.lead_id END) as unique_contacted_leads
      FROM leads l
      LEFT JOIN messages m ON l.id = m.lead_id
    `);

    const stats = result.rows[0];
    const estimatedConversions = Math.floor(stats.delivered_messages * parseFloat(conversionRate));
    const estimatedRevenue = estimatedConversions * parseFloat(averageCommission);
    const monthlyPotential = Math.floor(stats.recent_delivered * parseFloat(conversionRate) * parseFloat(averageCommission));

    res.json({
      success: true,
      data: {
        contactableLeads: parseInt(stats.contactable_leads),
        deliveredMessages: parseInt(stats.delivered_messages),
        recentDelivered: parseInt(stats.recent_delivered),
        uniqueContactedLeads: parseInt(stats.unique_contacted_leads),
        estimates: {
          conversionRate: parseFloat(conversionRate),
          averageCommission: parseFloat(averageCommission),
          estimatedConversions,
          estimatedRevenue,
          monthlyPotential
        }
      }
    });

  } catch (err) {
    logger.error('Failed to get revenue estimates', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get system health metrics
router.get('/system/health', async (req, res) => {
  try {
    // Database connection count
    const connectionsResult = await query(`
      SELECT count(*) as active_connections
      FROM pg_stat_activity 
      WHERE state = 'active'
    `);

    // Recent error rates
    const errorsResult = await query(`
      SELECT 
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_messages,
        COUNT(*) as total_messages,
        ROUND(
          COUNT(CASE WHEN status = 'failed' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 
          2
        ) as error_rate
      FROM messages 
      WHERE created_at >= CURRENT_DATE - INTERVAL '24 hours'
    `);

    // Pending messages
    const pendingResult = await query(`
      SELECT 
        message_type,
        COUNT(*) as pending_count
      FROM messages 
      WHERE status = 'pending'
      GROUP BY message_type
    `);

    // Recent import failures
    const importErrorsResult = await query(`
      SELECT COUNT(*) as failed_imports
      FROM import_logs 
      WHERE status = 'failed' 
        AND started_at >= CURRENT_DATE - INTERVAL '24 hours'
    `);

    res.json({
      success: true,
      data: {
        database: {
          activeConnections: parseInt(connectionsResult.rows[0].active_connections)
        },
        messages: {
          ...errorsResult.rows[0],
          pending: pendingResult.rows
        },
        imports: {
          recentFailures: parseInt(importErrorsResult.rows[0].failed_imports)
        },
        timestamp: new Date().toISOString()
      }
    });

  } catch (err) {
    logger.error('Failed to get system health', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

module.exports = router;
