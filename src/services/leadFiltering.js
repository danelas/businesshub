const { query, logger } = require('../database/connection');

class LeadFilteringService {
  constructor() {
    this.defaultFilters = {
      status: ['active'],
      excludeOptedOut: true,
      minRegistrationDays: 1, // Minimum days since registration
      maxRegistrationDays: 365, // Maximum days since registration
      requireContact: true // Require phone or email
    };
  }

  // Build WHERE clause from filters
  buildWhereClause(filters = {}) {
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    // Merge with default filters
    const mergedFilters = { ...this.defaultFilters, ...filters };

    // Status filter
    if (mergedFilters.status && mergedFilters.status.length > 0) {
      const statusPlaceholders = mergedFilters.status.map(() => `$${paramIndex++}`).join(',');
      conditions.push(`l.status IN (${statusPlaceholders})`);
      params.push(...mergedFilters.status);
    }

    // State filter
    if (mergedFilters.states && mergedFilters.states.length > 0) {
      const statePlaceholders = mergedFilters.states.map(() => `$${paramIndex++}`).join(',');
      conditions.push(`l.state IN (${statePlaceholders})`);
      params.push(...mergedFilters.states);
    }

    // Business type filter
    if (mergedFilters.businessTypes && mergedFilters.businessTypes.length > 0) {
      const typePlaceholders = mergedFilters.businessTypes.map(() => `$${paramIndex++}`).join(',');
      conditions.push(`l.business_type IN (${typePlaceholders})`);
      params.push(...mergedFilters.businessTypes);
    }

    // Industry filter
    if (mergedFilters.industries && mergedFilters.industries.length > 0) {
      const industryPlaceholders = mergedFilters.industries.map(() => `$${paramIndex++}`).join(',');
      conditions.push(`l.industry IN (${industryPlaceholders})`);
      params.push(...mergedFilters.industries);
    }

    // Registration date range
    if (mergedFilters.minRegistrationDays !== undefined) {
      conditions.push(`l.registration_date >= CURRENT_DATE - INTERVAL '${mergedFilters.minRegistrationDays} days'`);
    }

    if (mergedFilters.maxRegistrationDays !== undefined) {
      conditions.push(`l.registration_date <= CURRENT_DATE - INTERVAL '${mergedFilters.maxRegistrationDays} days'`);
    }

    // Specific date range
    if (mergedFilters.registrationDateFrom) {
      conditions.push(`l.registration_date >= $${paramIndex++}`);
      params.push(mergedFilters.registrationDateFrom);
    }

    if (mergedFilters.registrationDateTo) {
      conditions.push(`l.registration_date <= $${paramIndex++}`);
      params.push(mergedFilters.registrationDateTo);
    }

    // Employee count range
    if (mergedFilters.minEmployees !== undefined) {
      conditions.push(`l.employee_count_estimate >= $${paramIndex++}`);
      params.push(mergedFilters.minEmployees);
    }

    if (mergedFilters.maxEmployees !== undefined) {
      conditions.push(`l.employee_count_estimate <= $${paramIndex++}`);
      params.push(mergedFilters.maxEmployees);
    }

    // Revenue range
    if (mergedFilters.minRevenue !== undefined) {
      conditions.push(`l.revenue_estimate >= $${paramIndex++}`);
      params.push(mergedFilters.minRevenue);
    }

    if (mergedFilters.maxRevenue !== undefined) {
      conditions.push(`l.revenue_estimate <= $${paramIndex++}`);
      params.push(mergedFilters.maxRevenue);
    }

    // Contact requirements
    if (mergedFilters.requireContact) {
      conditions.push(`(l.phone IS NOT NULL OR l.email IS NOT NULL)`);
    }

    if (mergedFilters.requirePhone) {
      conditions.push(`l.phone IS NOT NULL`);
    }

    if (mergedFilters.requireEmail) {
      conditions.push(`l.email IS NOT NULL`);
    }

    // Exclude opted out leads
    if (mergedFilters.excludeOptedOut) {
      conditions.push(`
        NOT EXISTS (
          SELECT 1 FROM opt_outs o 
          WHERE (o.phone = l.phone AND o.opt_out_type IN ('sms', 'all'))
             OR (o.email = l.email AND o.opt_out_type IN ('email', 'all'))
             OR o.lead_id = l.id
        )
      `);
    }

    // Exclude already contacted leads (optional)
    if (mergedFilters.excludeContacted) {
      const contactedDays = mergedFilters.contactedWithinDays || 30;
      conditions.push(`
        NOT EXISTS (
          SELECT 1 FROM messages m 
          WHERE m.lead_id = l.id 
            AND m.status IN ('sent', 'delivered')
            AND m.sent_at >= CURRENT_DATE - INTERVAL '${contactedDays} days'
        )
      `);
    }

    // Exclude specific campaigns
    if (mergedFilters.excludeCampaigns && mergedFilters.excludeCampaigns.length > 0) {
      const campaignPlaceholders = mergedFilters.excludeCampaigns.map(() => `$${paramIndex++}`).join(',');
      conditions.push(`
        NOT EXISTS (
          SELECT 1 FROM messages m 
          WHERE m.lead_id = l.id 
            AND m.campaign_id IN (${campaignPlaceholders})
        )
      `);
      params.push(...mergedFilters.excludeCampaigns);
    }

    // Company name search
    if (mergedFilters.companyNameSearch) {
      conditions.push(`l.company_name ILIKE $${paramIndex++}`);
      params.push(`%${mergedFilters.companyNameSearch}%`);
    }

    return {
      whereClause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
      params
    };
  }

  // Get filtered leads with pagination
  async getFilteredLeads(filters = {}, options = {}) {
    const { limit = 100, offset = 0, orderBy = 'registration_date', orderDirection = 'DESC' } = options;
    
    const { whereClause, params } = this.buildWhereClause(filters);
    
    // Validate orderBy to prevent SQL injection
    const allowedOrderBy = ['registration_date', 'company_name', 'state', 'import_date'];
    const safeOrderBy = allowedOrderBy.includes(orderBy) ? orderBy : 'registration_date';
    const safeDirection = orderDirection.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const queryText = `
      SELECT 
        l.*,
        CASE 
          WHEN l.phone IS NOT NULL AND l.email IS NOT NULL THEN 'both'
          WHEN l.phone IS NOT NULL THEN 'phone'
          WHEN l.email IS NOT NULL THEN 'email'
          ELSE 'none'
        END as contact_type
      FROM leads l
      ${whereClause}
      ORDER BY l.${safeOrderBy} ${safeDirection}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const result = await query(queryText, [...params, limit, offset]);
    
    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) as total
      FROM leads l
      ${whereClause}
    `;
    
    const countResult = await query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);

    return {
      leads: result.rows,
      pagination: {
        total,
        limit,
        offset,
        pages: Math.ceil(total / limit),
        currentPage: Math.floor(offset / limit) + 1
      }
    };
  }

  // Get leads for a specific campaign
  async getLeadsForCampaign(campaignId, limit = 100) {
    const campaignResult = await query(`
      SELECT * FROM campaigns WHERE id = $1 AND is_active = true
    `, [campaignId]);

    if (campaignResult.rows.length === 0) {
      throw new Error('Campaign not found or inactive');
    }

    const campaign = campaignResult.rows[0];
    
    // Build filters from campaign criteria
    const filters = {
      status: ['active'],
      excludeOptedOut: true,
      excludeContacted: true,
      contactedWithinDays: 30
    };

    if (campaign.target_states && campaign.target_states.length > 0) {
      filters.states = campaign.target_states;
    }

    if (campaign.target_business_types && campaign.target_business_types.length > 0) {
      filters.businessTypes = campaign.target_business_types;
    }

    if (campaign.target_industries && campaign.target_industries.length > 0) {
      filters.industries = campaign.target_industries;
    }

    if (campaign.min_registration_date) {
      filters.registrationDateFrom = campaign.min_registration_date;
    }

    if (campaign.max_registration_date) {
      filters.registrationDateTo = campaign.max_registration_date;
    }

    // Require appropriate contact method
    if (campaign.message_type === 'sms') {
      filters.requirePhone = true;
    } else if (campaign.message_type === 'email') {
      filters.requireEmail = true;
    }

    // Exclude leads already in this campaign
    filters.excludeCampaigns = [campaignId];

    return await this.getFilteredLeads(filters, { limit, orderBy: 'registration_date', orderDirection: 'ASC' });
  }

  // Remove duplicate leads
  async removeDuplicates(dryRun = true) {
    logger.info('Starting duplicate removal process', { dryRun });

    // Find duplicates based on dedup_hash
    const duplicatesQuery = `
      SELECT 
        dedup_hash,
        COUNT(*) as count,
        ARRAY_AGG(id ORDER BY import_date ASC) as lead_ids,
        MIN(import_date) as first_import,
        MAX(import_date) as last_import
      FROM leads 
      WHERE status != 'duplicate'
      GROUP BY dedup_hash 
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
    `;

    const duplicatesResult = await query(duplicatesQuery);
    const duplicateGroups = duplicatesResult.rows;

    if (duplicateGroups.length === 0) {
      logger.info('No duplicates found');
      return { duplicateGroups: 0, leadsMarked: 0 };
    }

    let totalMarked = 0;

    if (!dryRun) {
      for (const group of duplicateGroups) {
        // Keep the first (oldest) lead, mark others as duplicate
        const [keepId, ...duplicateIds] = group.lead_ids;
        
        if (duplicateIds.length > 0) {
          await query(`
            UPDATE leads 
            SET status = 'duplicate', last_updated = CURRENT_TIMESTAMP
            WHERE id = ANY($1)
          `, [duplicateIds]);
          
          totalMarked += duplicateIds.length;
        }
      }
    } else {
      // Calculate what would be marked
      totalMarked = duplicateGroups.reduce((sum, group) => sum + (group.count - 1), 0);
    }

    logger.info('Duplicate removal completed', { 
      duplicateGroups: duplicateGroups.length, 
      leadsMarked: totalMarked,
      dryRun 
    });

    return { 
      duplicateGroups: duplicateGroups.length, 
      leadsMarked: totalMarked,
      details: duplicateGroups 
    };
  }

  // Get segmentation statistics
  async getSegmentationStats() {
    const stats = {};

    // By state
    const stateStats = await query(`
      SELECT state, COUNT(*) as count
      FROM leads 
      WHERE status = 'active'
      GROUP BY state 
      ORDER BY count DESC
    `);
    stats.byState = stateStats.rows;

    // By business type
    const businessTypeStats = await query(`
      SELECT business_type, COUNT(*) as count
      FROM leads 
      WHERE status = 'active' AND business_type IS NOT NULL
      GROUP BY business_type 
      ORDER BY count DESC
      LIMIT 20
    `);
    stats.byBusinessType = businessTypeStats.rows;

    // By industry
    const industryStats = await query(`
      SELECT industry, COUNT(*) as count
      FROM leads 
      WHERE status = 'active' AND industry IS NOT NULL
      GROUP BY industry 
      ORDER BY count DESC
      LIMIT 20
    `);
    stats.byIndustry = industryStats.rows;

    // By registration date (last 12 months)
    const registrationStats = await query(`
      SELECT 
        DATE_TRUNC('month', registration_date) as month,
        COUNT(*) as count
      FROM leads 
      WHERE status = 'active' 
        AND registration_date >= CURRENT_DATE - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', registration_date)
      ORDER BY month DESC
    `);
    stats.byRegistrationMonth = registrationStats.rows;

    // Contact availability
    const contactStats = await query(`
      SELECT 
        CASE 
          WHEN phone IS NOT NULL AND email IS NOT NULL THEN 'both'
          WHEN phone IS NOT NULL THEN 'phone_only'
          WHEN email IS NOT NULL THEN 'email_only'
          ELSE 'none'
        END as contact_type,
        COUNT(*) as count
      FROM leads 
      WHERE status = 'active'
      GROUP BY contact_type
    `);
    stats.byContactType = contactStats.rows;

    return stats;
  }

  // Create a custom segment
  async createSegment(name, description, filters) {
    const { whereClause, params } = this.buildWhereClause(filters);
    
    // Count leads in this segment
    const countQuery = `
      SELECT COUNT(*) as total
      FROM leads l
      ${whereClause}
    `;
    
    const countResult = await query(countQuery, params);
    const leadCount = parseInt(countResult.rows[0].total);

    // Save segment (you might want to create a segments table)
    logger.info('Custom segment created', { name, description, leadCount, filters });

    return { name, description, leadCount, filters };
  }
}

module.exports = LeadFilteringService;
