const express = require('express');
const FloridaDataService = require('../services/floridaDataService');
const ContactEnrichmentService = require('../services/contactEnrichmentService');
const { query, logger } = require('../database/connection');

const router = express.Router();
const floridaService = new FloridaDataService();
const enrichmentService = new ContactEnrichmentService();

// Get Florida LLC statistics
router.get('/stats', async (req, res) => {
  try {
    const { days = 30 } = req.query;
    
    // Get Florida LLC stats from view
    const statsResult = await query(`
      SELECT * FROM florida_llc_stats 
      WHERE registration_day >= CURRENT_DATE - INTERVAL '${days} days'
      ORDER BY registration_day DESC
    `);
    
    // Get enrichment performance
    const enrichmentResult = await query(`
      SELECT * FROM enrichment_performance 
      WHERE enrichment_day >= CURRENT_DATE - INTERVAL '${days} days'
      ORDER BY enrichment_day DESC
    `);
    
    // Get overall totals
    const totalsResult = await query(`
      SELECT 
        COUNT(*) as total_florida_llcs,
        COUNT(CASE WHEN phone IS NOT NULL THEN 1 END) as with_phone,
        COUNT(CASE WHEN email IS NOT NULL THEN 1 END) as with_email,
        COUNT(CASE WHEN website IS NOT NULL THEN 1 END) as with_website,
        COUNT(CASE WHEN enrichment_status = 'completed' THEN 1 END) as enriched,
        AVG(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - registration_date)) / 86400) as avg_age_days
      FROM leads 
      WHERE state = 'FL' 
        AND registration_date >= CURRENT_DATE - INTERVAL '${days} days'
    `);
    
    res.json({
      success: true,
      data: {
        daily: statsResult.rows,
        enrichment: enrichmentResult.rows,
        totals: totalsResult.rows[0]
      }
    });

  } catch (err) {
    logger.error('Failed to get Florida stats', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// List available files on Florida SFTP
router.get('/files/available', async (req, res) => {
  try {
    const files = await floridaService.listAvailableFiles();
    
    res.json({
      success: true,
      data: files
    });

  } catch (err) {
    logger.error('Failed to list Florida SFTP files', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get download history
router.get('/files/downloads', async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    const result = await query(`
      SELECT * FROM florida_file_downloads 
      ORDER BY download_date DESC
      LIMIT $1 OFFSET $2
    `, [parseInt(limit), offset]);
    
    const countResult = await query('SELECT COUNT(*) as total FROM florida_file_downloads');
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
    logger.error('Failed to get download history', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Trigger Florida data sync
router.post('/sync', async (req, res) => {
  try {
    const { 
      downloadOnly = false, 
      processOnly = false, 
      daysBack = 7,
      enrichContacts = false,
      enrichLimit = 50 
    } = req.body;
    
    logger.info('Starting Florida sync via API', { 
      downloadOnly, 
      processOnly, 
      daysBack, 
      enrichContacts 
    });
    
    const results = {
      filesDownloaded: 0,
      filesProcessed: 0,
      newRecords: 0,
      enrichedLeads: 0
    };
    
    // Download phase
    if (!processOnly) {
      const downloadResult = await floridaService.downloadFiles();
      results.filesDownloaded = downloadResult.length;
    }
    
    // Process phase
    if (!downloadOnly) {
      const processResult = await floridaService.processFloridaFiles(daysBack);
      results.filesProcessed = processResult.processed;
      results.newRecords = processResult.newRecords;
    }
    
    // Enrichment phase
    if (enrichContacts) {
      const enrichResult = await enrichmentService.enrichLeadsWithoutContacts(enrichLimit);
      results.enrichedLeads = enrichResult.enriched;
    }
    
    res.json({
      success: true,
      data: results,
      message: 'Florida sync completed successfully'
    });

  } catch (err) {
    logger.error('Florida sync via API failed', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Enrich specific lead
router.post('/enrich/:leadId', async (req, res) => {
  try {
    const { leadId } = req.params;
    
    const result = await enrichmentService.enrichLead(leadId);
    
    res.json({
      success: true,
      data: result
    });

  } catch (err) {
    logger.error('Lead enrichment failed', { leadId: req.params.leadId, error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Bulk enrich leads without contacts
router.post('/enrich/bulk', async (req, res) => {
  try {
    const { limit = 50 } = req.body;
    
    const result = await enrichmentService.enrichLeadsWithoutContacts(limit);
    
    res.json({
      success: true,
      data: result,
      message: `Processed ${result.processed} leads, enriched ${result.enriched} with contact info`
    });

  } catch (err) {
    logger.error('Bulk enrichment failed', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get enrichment history for a lead
router.get('/enrich/history/:leadId', async (req, res) => {
  try {
    const { leadId } = req.params;
    
    const result = await query(`
      SELECT * FROM contact_enrichment_log 
      WHERE lead_id = $1 
      ORDER BY enrichment_date DESC
    `, [leadId]);
    
    res.json({
      success: true,
      data: result.rows
    });

  } catch (err) {
    logger.error('Failed to get enrichment history', { 
      leadId: req.params.leadId, 
      error: err.message 
    });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get leads needing enrichment
router.get('/leads/need-enrichment', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50, 
      state = 'FL',
      daysOld = 30 
    } = req.query;
    
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    const leadsQuery = `
      SELECT 
        l.id,
        l.company_name,
        l.city,
        l.state,
        l.registration_date,
        l.phone,
        l.email,
        l.website,
        l.enrichment_status,
        l.last_enrichment_attempt,
        cel.enrichment_date as last_enrichment,
        cel.success as last_success
      FROM leads l
      LEFT JOIN contact_enrichment_log cel ON l.id = cel.lead_id 
        AND cel.enrichment_date = (
          SELECT MAX(enrichment_date) 
          FROM contact_enrichment_log 
          WHERE lead_id = l.id
        )
      WHERE l.state = $1
        AND (l.phone IS NULL OR l.email IS NULL)
        AND l.status = 'active'
        AND l.registration_date >= CURRENT_DATE - INTERVAL '${daysOld} days'
        AND (
          l.last_enrichment_attempt IS NULL 
          OR l.last_enrichment_attempt < CURRENT_DATE - INTERVAL '7 days'
        )
      ORDER BY l.registration_date DESC
      LIMIT $2 OFFSET $3
    `;
    
    const result = await query(leadsQuery, [state, parseInt(limit), offset]);
    
    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM leads l
      WHERE l.state = $1
        AND (l.phone IS NULL OR l.email IS NULL)
        AND l.status = 'active'
        AND l.registration_date >= CURRENT_DATE - INTERVAL '${daysOld} days'
        AND (
          l.last_enrichment_attempt IS NULL 
          OR l.last_enrichment_attempt < CURRENT_DATE - INTERVAL '7 days'
        )
    `;
    
    const countResult = await query(countQuery, [state]);
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
    logger.error('Failed to get leads needing enrichment', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get recent Florida LLCs
router.get('/leads/recent', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50, 
      days = 7,
      hasContact 
    } = req.query;
    
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    let whereConditions = [
      "state = 'FL'",
      "status = 'active'",
      `registration_date >= CURRENT_DATE - INTERVAL '${days} days'`
    ];
    
    if (hasContact === 'true') {
      whereConditions.push('(phone IS NOT NULL OR email IS NOT NULL)');
    } else if (hasContact === 'false') {
      whereConditions.push('(phone IS NULL AND email IS NULL)');
    }
    
    const whereClause = whereConditions.join(' AND ');
    
    const leadsQuery = `
      SELECT 
        l.*,
        CASE 
          WHEN l.phone IS NOT NULL AND l.email IS NOT NULL THEN 'both'
          WHEN l.phone IS NOT NULL THEN 'phone'
          WHEN l.email IS NOT NULL THEN 'email'
          ELSE 'none'
        END as contact_type,
        EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - l.registration_date)) / 86400 as days_old
      FROM leads l
      WHERE ${whereClause}
      ORDER BY l.registration_date DESC
      LIMIT $1 OFFSET $2
    `;
    
    const result = await query(leadsQuery, [parseInt(limit), offset]);
    
    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM leads l
      WHERE ${whereClause}
    `;
    
    const countResult = await query(countQuery);
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
    logger.error('Failed to get recent Florida LLCs', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get enrichment performance metrics
router.get('/enrichment/performance', async (req, res) => {
  try {
    const { days = 30 } = req.query;
    
    // Overall performance
    const overallResult = await query(`
      SELECT 
        COUNT(*) as total_attempts,
        COUNT(CASE WHEN success = true THEN 1 END) as successful_attempts,
        AVG(phones_found) as avg_phones_found,
        AVG(emails_found) as avg_emails_found,
        COUNT(CASE WHEN website_found = true THEN 1 END) as websites_found,
        AVG(processing_time_ms) as avg_processing_time_ms,
        ROUND(
          COUNT(CASE WHEN success = true THEN 1 END) * 100.0 / COUNT(*), 
          2
        ) as success_rate
      FROM contact_enrichment_log 
      WHERE enrichment_date >= CURRENT_DATE - INTERVAL '${days} days'
    `);
    
    // Performance by source
    const sourceResult = await query(`
      SELECT 
        jsonb_array_elements_text(sources) as source,
        COUNT(*) as usage_count,
        AVG(phones_found) as avg_phones,
        AVG(emails_found) as avg_emails
      FROM contact_enrichment_log 
      WHERE enrichment_date >= CURRENT_DATE - INTERVAL '${days} days'
        AND sources IS NOT NULL
      GROUP BY jsonb_array_elements_text(sources)
      ORDER BY usage_count DESC
    `);
    
    // Daily performance trend
    const dailyResult = await query(`
      SELECT 
        DATE_TRUNC('day', enrichment_date) as date,
        COUNT(*) as attempts,
        COUNT(CASE WHEN success = true THEN 1 END) as successful,
        AVG(processing_time_ms) as avg_time_ms
      FROM contact_enrichment_log 
      WHERE enrichment_date >= CURRENT_DATE - INTERVAL '${days} days'
      GROUP BY DATE_TRUNC('day', enrichment_date)
      ORDER BY date DESC
    `);
    
    res.json({
      success: true,
      data: {
        overall: overallResult.rows[0],
        bySources: sourceResult.rows,
        daily: dailyResult.rows
      }
    });

  } catch (err) {
    logger.error('Failed to get enrichment performance', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

module.exports = router;
