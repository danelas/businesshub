const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;

const DataIngestionService = require('../services/dataIngestion');
const LeadFilteringService = require('../services/leadFiltering');
const { query, logger } = require('../database/connection');

const router = express.Router();
const dataIngestion = new DataIngestionService();
const leadFiltering = new LeadFilteringService();

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  }
});

// Get leads with filtering and pagination
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      states,
      businessTypes,
      industries,
      status,
      search,
      orderBy = 'registration_date',
      orderDirection = 'DESC'
    } = req.query;

    const filters = {};
    
    if (states) filters.states = states.split(',');
    if (businessTypes) filters.businessTypes = businessTypes.split(',');
    if (industries) filters.industries = industries.split(',');
    if (status) filters.status = status.split(',');
    if (search) filters.companyNameSearch = search;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const options = {
      limit: parseInt(limit),
      offset,
      orderBy,
      orderDirection
    };

    const result = await leadFiltering.getFilteredLeads(filters, options);
    
    res.json({
      success: true,
      data: result.leads,
      pagination: result.pagination
    });

  } catch (err) {
    logger.error('Failed to get leads', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get single lead by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await query('SELECT * FROM leads WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Lead not found'
      });
    }

    // Get message history for this lead
    const messagesResult = await query(`
      SELECT id, message_type, template_name, status, sent_at, campaign_id
      FROM messages 
      WHERE lead_id = $1 
      ORDER BY created_at DESC
    `, [id]);

    res.json({
      success: true,
      data: {
        lead: result.rows[0],
        messageHistory: messagesResult.rows
      }
    });

  } catch (err) {
    logger.error('Failed to get lead', { leadId: req.params.id, error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Import leads from CSV
router.post('/import/csv', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    const { source = 'csv_import' } = req.body;
    
    logger.info('Starting CSV import', { 
      filename: req.file.originalname, 
      size: req.file.size,
      source 
    });

    const result = await dataIngestion.importFromCSV(req.file.path, source);

    // Clean up uploaded file
    await fs.unlink(req.file.path);

    res.json({
      success: true,
      data: {
        filename: req.file.originalname,
        totalProcessed: result.totalProcessed,
        newRecords: result.newRecords,
        duplicateRecords: result.duplicateRecords,
        errorRecords: result.errorRecords,
        validationErrors: result.validationErrors.slice(0, 10) // Limit error details
      }
    });

  } catch (err) {
    logger.error('CSV import failed', { error: err.message });
    
    // Clean up file on error
    if (req.file) {
      try {
        await fs.unlink(req.file.path);
      } catch (unlinkErr) {
        logger.error('Failed to clean up uploaded file', { error: unlinkErr.message });
      }
    }

    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Import leads from API
router.post('/import/api', async (req, res) => {
  try {
    const { apiUrl, apiKey, stateCode, source = 'api_import' } = req.body;

    if (!apiUrl || !stateCode) {
      return res.status(400).json({
        success: false,
        error: 'API URL and state code are required'
      });
    }

    logger.info('Starting API import', { apiUrl, stateCode, source });

    const result = await dataIngestion.importFromAPI(apiUrl, apiKey, stateCode, source);

    res.json({
      success: true,
      data: {
        apiUrl,
        stateCode,
        totalProcessed: result.totalProcessed,
        newRecords: result.newRecords,
        duplicateRecords: result.duplicateRecords,
        errorRecords: result.errorRecords,
        validationErrors: result.validationErrors.slice(0, 10)
      }
    });

  } catch (err) {
    logger.error('API import failed', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Update lead
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Build dynamic update query
    const allowedFields = [
      'company_name', 'state', 'business_type', 'status', 'phone', 'email',
      'website', 'industry', 'employee_count_estimate', 'revenue_estimate'
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

    updateFields.push(`last_updated = CURRENT_TIMESTAMP`);
    values.push(id);

    const updateQuery = `
      UPDATE leads 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await query(updateQuery, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Lead not found'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (err) {
    logger.error('Failed to update lead', { leadId: req.params.id, error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Delete lead
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await query('DELETE FROM leads WHERE id = $1 RETURNING id', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Lead not found'
      });
    }

    res.json({
      success: true,
      message: 'Lead deleted successfully'
    });

  } catch (err) {
    logger.error('Failed to delete lead', { leadId: req.params.id, error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get segmentation statistics
router.get('/stats/segmentation', async (req, res) => {
  try {
    const stats = await leadFiltering.getSegmentationStats();
    
    res.json({
      success: true,
      data: stats
    });

  } catch (err) {
    logger.error('Failed to get segmentation stats', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Remove duplicates
router.post('/deduplicate', async (req, res) => {
  try {
    const { dryRun = true } = req.body;
    
    const result = await leadFiltering.removeDuplicates(dryRun);
    
    res.json({
      success: true,
      data: {
        dryRun,
        duplicateGroups: result.duplicateGroups,
        leadsMarked: result.leadsMarked,
        details: dryRun ? result.details : undefined
      }
    });

  } catch (err) {
    logger.error('Failed to remove duplicates', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get import history
router.get('/imports/history', async (req, res) => {
  try {
    const { days = 30 } = req.query;
    
    const stats = await dataIngestion.getImportStats(parseInt(days));
    
    res.json({
      success: true,
      data: stats
    });

  } catch (err) {
    logger.error('Failed to get import history', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

module.exports = router;
