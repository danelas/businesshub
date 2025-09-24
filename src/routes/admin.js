const express = require('express');
const { query, transaction, logger } = require('../database/connection');

const router = express.Router();

// Get all message templates
router.get('/templates', async (req, res) => {
  try {
    const result = await query(`
      SELECT * FROM message_templates 
      ORDER BY type, name
    `);

    res.json({
      success: true,
      data: result.rows
    });

  } catch (err) {
    logger.error('Failed to get templates', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Create new message template
router.post('/templates', async (req, res) => {
  try {
    const { name, type, subject, content, variables } = req.body;

    if (!name || !type || !content) {
      return res.status(400).json({
        success: false,
        error: 'Name, type, and content are required'
      });
    }

    if (!['sms', 'email'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Type must be sms or email'
      });
    }

    const result = await query(`
      INSERT INTO message_templates (name, type, subject, content, variables)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [name, type, subject, content, JSON.stringify(variables || [])]);

    res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (err) {
    logger.error('Failed to create template', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Update message template
router.put('/templates/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, subject, content, variables, isActive } = req.body;

    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (type !== undefined) {
      updates.push(`type = $${paramIndex++}`);
      values.push(type);
    }
    if (subject !== undefined) {
      updates.push(`subject = $${paramIndex++}`);
      values.push(subject);
    }
    if (content !== undefined) {
      updates.push(`content = $${paramIndex++}`);
      values.push(content);
    }
    if (variables !== undefined) {
      updates.push(`variables = $${paramIndex++}`);
      values.push(JSON.stringify(variables));
    }
    if (isActive !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(isActive);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update'
      });
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const result = await query(`
      UPDATE message_templates 
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (err) {
    logger.error('Failed to update template', { templateId: req.params.id, error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Delete message template
router.delete('/templates/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await query('DELETE FROM message_templates WHERE id = $1 RETURNING id', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    res.json({
      success: true,
      message: 'Template deleted successfully'
    });

  } catch (err) {
    logger.error('Failed to delete template', { templateId: req.params.id, error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get system settings
router.get('/settings', async (req, res) => {
  try {
    const result = await query('SELECT * FROM system_settings ORDER BY key');

    const settings = {};
    result.rows.forEach(row => {
      settings[row.key] = {
        value: row.value,
        description: row.description,
        updatedAt: row.updated_at
      };
    });

    res.json({
      success: true,
      data: settings
    });

  } catch (err) {
    logger.error('Failed to get system settings', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Update system setting
router.put('/settings/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { value, description } = req.body;

    if (value === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Value is required'
      });
    }

    const result = await query(`
      INSERT INTO system_settings (key, value, description)
      VALUES ($1, $2, $3)
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        description = COALESCE(EXCLUDED.description, system_settings.description),
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [key, value.toString(), description]);

    res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (err) {
    logger.error('Failed to update system setting', { key: req.params.key, error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get all opt-outs with filtering
router.get('/opt-outs', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      type,
      source,
      search
    } = req.query;

    let whereConditions = [];
    let params = [];
    let paramIndex = 1;

    if (type) {
      whereConditions.push(`opt_out_type = $${paramIndex++}`);
      params.push(type);
    }

    if (source) {
      whereConditions.push(`source = $${paramIndex++}`);
      params.push(source);
    }

    if (search) {
      whereConditions.push(`(phone ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const optOutsQuery = `
      SELECT 
        o.*,
        l.company_name,
        l.state
      FROM opt_outs o
      LEFT JOIN leads l ON o.lead_id = l.id
      ${whereClause}
      ORDER BY o.opted_out_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

    params.push(parseInt(limit), offset);

    const result = await query(optOutsQuery, params);

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM opt_outs o
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
    logger.error('Failed to get opt-outs', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Remove opt-out (re-enable contact)
router.delete('/opt-outs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await query('DELETE FROM opt_outs WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Opt-out record not found'
      });
    }

    logger.info('Opt-out removed', { optOutId: id, ...result.rows[0] });

    res.json({
      success: true,
      message: 'Opt-out removed successfully',
      data: result.rows[0]
    });

  } catch (err) {
    logger.error('Failed to remove opt-out', { optOutId: req.params.id, error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Bulk operations for leads
router.post('/leads/bulk-update', async (req, res) => {
  try {
    const { leadIds, updates } = req.body;

    if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Lead IDs array is required'
      });
    }

    if (!updates || Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Updates object is required'
      });
    }

    const allowedFields = ['status', 'business_type', 'industry'];
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
    
    const placeholders = leadIds.map(() => `$${paramIndex++}`).join(',');
    values.push(...leadIds);

    const updateQuery = `
      UPDATE leads 
      SET ${updateFields.join(', ')}
      WHERE id IN (${placeholders})
    `;

    const result = await query(updateQuery, values);

    res.json({
      success: true,
      message: `Updated ${result.rowCount} leads`,
      updatedCount: result.rowCount
    });

  } catch (err) {
    logger.error('Failed to bulk update leads', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Clean up old data
router.post('/cleanup', async (req, res) => {
  try {
    const { 
      deleteOldMessages = false, 
      deleteOldImportLogs = false,
      messagesDays = 90,
      importLogsDays = 30,
      dryRun = true 
    } = req.body;

    const results = {};

    if (deleteOldMessages) {
      const messagesQuery = dryRun 
        ? `SELECT COUNT(*) as count FROM messages WHERE created_at < CURRENT_DATE - INTERVAL '${messagesDays} days' AND status IN ('delivered', 'failed')`
        : `DELETE FROM messages WHERE created_at < CURRENT_DATE - INTERVAL '${messagesDays} days' AND status IN ('delivered', 'failed')`;
      
      const messagesResult = await query(messagesQuery);
      results.messages = dryRun 
        ? { wouldDelete: parseInt(messagesResult.rows[0].count) }
        : { deleted: messagesResult.rowCount };
    }

    if (deleteOldImportLogs) {
      const logsQuery = dryRun
        ? `SELECT COUNT(*) as count FROM import_logs WHERE completed_at < CURRENT_DATE - INTERVAL '${importLogsDays} days'`
        : `DELETE FROM import_logs WHERE completed_at < CURRENT_DATE - INTERVAL '${importLogsDays} days'`;
      
      const logsResult = await query(logsQuery);
      results.importLogs = dryRun
        ? { wouldDelete: parseInt(logsResult.rows[0].count) }
        : { deleted: logsResult.rowCount };
    }

    res.json({
      success: true,
      dryRun,
      data: results
    });

  } catch (err) {
    logger.error('Failed to cleanup data', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Database maintenance
router.post('/maintenance/vacuum', async (req, res) => {
  try {
    const tables = ['leads', 'messages', 'campaigns', 'opt_outs', 'import_logs'];
    const results = [];

    for (const table of tables) {
      try {
        await query(`VACUUM ANALYZE ${table}`);
        results.push({ table, status: 'success' });
      } catch (err) {
        results.push({ table, status: 'error', error: err.message });
      }
    }

    res.json({
      success: true,
      data: results
    });

  } catch (err) {
    logger.error('Failed to run vacuum', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// Get database size information
router.get('/database/size', async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        schemaname,
        tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
        pg_total_relation_size(schemaname||'.'||tablename) as size_bytes
      FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
    `);

    const totalResult = await query(`
      SELECT pg_size_pretty(pg_database_size(current_database())) as total_size
    `);

    res.json({
      success: true,
      data: {
        totalSize: totalResult.rows[0].total_size,
        tables: result.rows
      }
    });

  } catch (err) {
    logger.error('Failed to get database size', { error: err.message });
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

module.exports = router;
