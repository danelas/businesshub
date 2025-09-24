const express = require('express');
const { query, logger } = require('../database/connection');
const FloridaDataService = require('../services/floridaDataService');
const ContactEnrichmentService = require('../services/contactEnrichmentService');
const YelpEnrichmentService = require('../services/yelpEnrichmentService');
const CombinedEnrichmentService = require('../services/combinedEnrichmentService');

const router = express.Router();

// Test dashboard - view all Florida LLC data
router.get('/dashboard', async (req, res) => {
  try {
    // Prevent caching
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Florida LLC Test Dashboard</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .header { background: #007bff; color: white; padding: 20px; margin: -20px -20px 20px -20px; border-radius: 8px 8px 0 0; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 30px; }
        .stat-card { background: #f8f9fa; padding: 15px; border-radius: 5px; text-align: center; border-left: 4px solid #007bff; }
        .stat-number { font-size: 24px; font-weight: bold; color: #007bff; }
        .stat-label { color: #666; font-size: 14px; }
        .controls { margin-bottom: 20px; padding: 15px; background: #e9ecef; border-radius: 5px; }
        .btn { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; margin-right: 10px; }
        .btn:hover { background: #0056b3; }
        .btn-success { background: #28a745; }
        .btn-warning { background: #ffc107; color: #212529; }
        .table-container { overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #f8f9fa; font-weight: bold; }
        .phone { color: #28a745; font-weight: bold; }
        .email { color: #007bff; }
        .no-contact { color: #dc3545; }
        .enriched { background: #d4edda; }
        .pending { background: #fff3cd; }
        .loading { text-align: center; padding: 40px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🏢 Florida LLC Test Dashboard</h1>
            <p>Real-time monitoring of Florida LLC data ingestion and contact enrichment</p>
            <p><small>Last loaded: ${new Date().toLocaleString()}</small></p>
        </div>

        <div class="stats" id="stats">
            <div class="stat-card">
                <div class="stat-number" id="totalLLCs">-</div>
                <div class="stat-label">Total Florida LLCs</div>
            </div>
            <div class="stat-card">
                <div class="stat-number" id="withPhone">-</div>
                <div class="stat-label">With Phone Numbers</div>
            </div>
            <div class="stat-card">
                <div class="stat-number" id="withEmail">-</div>
                <div class="stat-label">With Email Addresses</div>
            </div>
            <div class="stat-card">
                <div class="stat-number" id="enrichmentRate">-</div>
                <div class="stat-label">Contact Rate %</div>
            </div>
        </div>

        <div class="controls">
            <button class="btn" onclick="triggerSync()">🔄 Sync Florida Data</button>
            <button class="btn btn-success" onclick="enrichContacts()">📞 Enrich Contacts (Yelp + Google)</button>
            <button class="btn btn-warning" onclick="refreshData()">🔄 Refresh Dashboard</button>
        </div>

        <div class="table-container">
            <h3>Recent Florida LLCs</h3>
            <table id="llcTable">
                <thead>
                    <tr>
                        <th>Company Name</th>
                        <th>Registration Date</th>
                        <th>City</th>
                        <th>Phone</th>
                        <th>Email</th>
                        <th>Website</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody id="llcTableBody">
                    <tr><td colspan="7" class="loading">Loading data...</td></tr>
                </tbody>
            </table>
        </div>
    </div>

    <script>
        // Load initial data
        refreshData();

        async function refreshData() {
            try {
                console.log('Refreshing dashboard data...');
                const response = await fetch('/api/test/florida-stats');
                
                if (!response.ok) {
                    throw new Error('HTTP ' + response.status + ': ' + response.statusText);
                }
                
                const data = await response.json();
                console.log('Dashboard data received:', data);
                
                if (data.success) {
                    updateStats(data.stats);
                    updateTable(data.leads);
                } else {
                    console.error('API returned error:', data.error);
                    document.getElementById('totalLLCs').textContent = 'Error';
                }
            } catch (err) {
                console.error('Failed to load data:', err);
            }
        }

        function updateStats(stats) {
            document.getElementById('totalLLCs').textContent = stats.total || 0;
            document.getElementById('withPhone').textContent = stats.withPhone || 0;
            document.getElementById('withEmail').textContent = stats.withEmail || 0;
            document.getElementById('enrichmentRate').textContent = (stats.contactRate || 0) + '%';
        }

        function updateTable(leads) {
            const tbody = document.getElementById('llcTableBody');
            
            if (!leads || leads.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="loading">No Florida LLC data found. Try syncing data first.</td></tr>';
                return;
            }

            tbody.innerHTML = leads.map(lead => {
                const rowClass = (lead.phone || lead.email) ? 'enriched' : 
                                lead.enrichment_status === 'pending' ? 'pending' : '';
                
                return \`
                    <tr class="\${rowClass}">
                        <td><strong>\${lead.company_name}</strong></td>
                        <td>\${new Date(lead.registration_date).toLocaleDateString()}</td>
                        <td>\${lead.city || '-'}</td>
                        <td class="phone">\${lead.phone || '-'}</td>
                        <td class="email">\${lead.email || '-'}</td>
                        <td>\${lead.website ? \`<a href="\${lead.website}" target="_blank">Visit</a>\` : '-'}</td>
                        <td>\${lead.enrichment_status || 'pending'}</td>
                    </tr>
                \`;
            }).join('');
        }

        async function triggerSync() {
            const btn = event.target;
            btn.textContent = '⏳ Syncing...';
            btn.disabled = true;

            try {
                const response = await fetch('/api/test/sync-florida', { method: 'POST' });
                const result = await response.json();
                
                if (result.success) {
                    alert('Sync completed! Processed ' + result.processed + ' records.');
                    refreshData();
                } else {
                    alert('Sync failed: ' + result.error);
                }
            } catch (err) {
                alert('Sync failed: ' + err.message);
            } finally {
                btn.textContent = '🔄 Sync Florida Data';
                btn.disabled = false;
            }
        }

        async function enrichContacts() {
            const btn = event.target;
            btn.textContent = '⏳ Enriching...';
            btn.disabled = true;

            try {
                const response = await fetch('/api/test/enrich-contacts', { method: 'POST' });
                const result = await response.json();
                
                if (result.success) {
                    alert('Enrichment completed! Found contacts for ' + result.enriched + ' leads.');
                    refreshData();
                } else {
                    alert('Enrichment failed: ' + result.error);
                }
            } catch (err) {
                alert('Enrichment failed: ' + err.message);
            } finally {
                btn.textContent = '📞 Enrich Contacts (Yelp + Google)';
                btn.disabled = false;
            }
        }

        // Auto-refresh every 30 seconds
        setInterval(refreshData, 30000);
    </script>
</body>
</html>`;

    res.send(html);
  } catch (err) {
    logger.error('Test dashboard error', { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get Florida LLC statistics and recent data
router.get('/florida-stats', async (req, res) => {
  try {
    // Get statistics
    const statsResult = await query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN phone IS NOT NULL THEN 1 END) as with_phone,
        COUNT(CASE WHEN email IS NOT NULL THEN 1 END) as with_email,
        COUNT(CASE WHEN phone IS NOT NULL OR email IS NOT NULL THEN 1 END) as with_contact,
        ROUND(
          COUNT(CASE WHEN phone IS NOT NULL OR email IS NOT NULL THEN 1 END) * 100.0 / 
          NULLIF(COUNT(*), 0), 2
        ) as contact_rate
      FROM leads 
      WHERE state = 'FL' 
        AND registration_date >= CURRENT_DATE - INTERVAL '30 days'
    `);

    // Get recent leads
    const leadsResult = await query(`
      SELECT 
        company_name, registration_date, city, phone, email, website, 
        enrichment_status, import_date
      FROM leads 
      WHERE state = 'FL' 
      ORDER BY registration_date DESC, import_date DESC 
      LIMIT 50
    `);

    const stats = statsResult.rows[0] || {
      total: 0, with_phone: 0, with_email: 0, with_contact: 0, contact_rate: 0
    };

    res.json({
      success: true,
      stats: {
        total: parseInt(stats.total),
        withPhone: parseInt(stats.with_phone),
        withEmail: parseInt(stats.with_email),
        withContact: parseInt(stats.with_contact),
        contactRate: parseFloat(stats.contact_rate) || 0
      },
      leads: leadsResult.rows
    });

  } catch (err) {
    logger.error('Florida stats error', { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

// Test Florida data sync
router.post('/sync-florida', async (req, res) => {
  try {
    const floridaService = new FloridaDataService();
    
    // Sync last 3 days of data
    const result = await floridaService.syncData({
      daysBack: 3,
      enrichContacts: false // Don't enrich during sync
    });

    res.json({
      success: true,
      message: 'Florida data sync completed',
      processed: result.totalProcessed || 0,
      imported: result.newRecords || 0,
      duplicates: result.duplicates || 0
    });

  } catch (err) {
    logger.error('Test sync error', { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

// Debug database connection
router.get('/debug-db', async (req, res) => {
  res.json({
    DATABASE_URL: process.env.DATABASE_URL ? 'SET' : 'NOT SET',
    YELP_API_KEY: process.env.YELP_API_KEY ? 'SET' : 'NOT SET',
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY ? 'SET' : 'NOT SET',
    GOOGLE_SEARCH_ENGINE_ID: process.env.GOOGLE_SEARCH_ENGINE_ID ? 'SET' : 'NOT SET',
    NODE_ENV: process.env.NODE_ENV,
    // Don't expose full keys for security, just show if they're set
    url_preview: process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 20) + '...' : 'MISSING',
    yelp_preview: process.env.YELP_API_KEY ? process.env.YELP_API_KEY.substring(0, 10) + '...' : 'MISSING',
    google_preview: process.env.GOOGLE_API_KEY ? process.env.GOOGLE_API_KEY.substring(0, 10) + '...' : 'MISSING'
  });
});

// Combined Yelp + Google contact enrichment
router.post('/enrich-contacts', async (req, res) => {
  try {
    logger.info('Enrichment request started');
    
    // Check if at least one API key is configured
    const hasYelp = !!process.env.YELP_API_KEY;
    const hasGoogle = !!process.env.GOOGLE_API_KEY && !!process.env.GOOGLE_SEARCH_ENGINE_ID;
    
    logger.info('API key status', { hasYelp, hasGoogle });
    
    if (!hasYelp && !hasGoogle) {
      logger.error('No API keys configured');
      return res.status(400).json({
        success: false,
        error: 'No API keys configured. Please add YELP_API_KEY and/or GOOGLE_API_KEY + GOOGLE_SEARCH_ENGINE_ID to environment variables.'
      });
    }

    // Get leads without contact info
    logger.info('Querying for leads to enrich');
    const leadsResult = await query(`
      SELECT id, company_name, city, state 
      FROM leads 
      WHERE state = 'FL' 
        AND (phone IS NULL OR email IS NULL)
        AND (enrichment_status IS NULL OR enrichment_status = 'pending' OR enrichment_status = 'failed')
        AND registration_date >= CURRENT_DATE - INTERVAL '7 days'
      ORDER BY registration_date DESC
      LIMIT 8
    `);

    logger.info('Found leads for enrichment', { count: leadsResult.rows.length });

    if (leadsResult.rows.length === 0) {
      logger.info('No leads found that need enrichment');
      return res.json({
        success: true,
        message: 'No leads found that need enrichment',
        processed: 0,
        enriched: 0,
        phonesFound: 0,
        emailsFound: 0
      });
    }

    logger.info('Starting combined enrichment', { 
      leadCount: leadsResult.rows.length,
      hasYelp,
      hasGoogle,
      leads: leadsResult.rows.map(l => ({ id: l.id, name: l.company_name, city: l.city }))
    });

    try {
      const combinedService = new CombinedEnrichmentService();
      const leadIds = leadsResult.rows.map(lead => lead.id);

      logger.info('Created combined service, starting enrichment');

      // Use combined enrichment with rate limiting
      const result = await combinedService.enrichMultipleLeads(leadIds, {
        batchSize: 2, // Small batches to respect API rate limits
        delayBetweenBatches: 4000 // 4 second delay between batches
      });

      logger.info('Enrichment completed', { result });
    } catch (enrichmentError) {
      logger.error('Enrichment service error', { error: enrichmentError.message, stack: enrichmentError.stack });
      throw enrichmentError;
    }

    res.json({
      success: true,
      message: `Combined enrichment completed (Yelp: ${hasYelp ? 'ON' : 'OFF'}, Google: ${hasGoogle ? 'ON' : 'OFF'})`,
      processed: result.total,
      enriched: result.success,
      failed: result.failed,
      phonesFound: result.phonesFound,
      emailsFound: result.emailsFound,
      details: result.results.map(r => ({
        leadId: r.leadId || (r.lead && r.lead.id),
        success: r.success,
        company: r.lead && r.lead.company_name,
        phone: r.enrichmentData && r.enrichmentData.phone,
        email: r.enrichmentData && r.enrichmentData.email,
        website: r.enrichmentData && r.enrichmentData.website,
        sources: r.enrichmentData && r.enrichmentData.sources.map(s => s.source),
        processingTime: r.processingTime,
        error: r.error
      }))
    });

  } catch (err) {
    logger.error('Combined enrichment error', { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

// Simple test endpoint for debugging enrichment
router.post('/test-enrichment', async (req, res) => {
  try {
    logger.info('Test enrichment endpoint called');
    
    // Check API keys
    const hasYelp = !!process.env.YELP_API_KEY;
    const hasGoogle = !!process.env.GOOGLE_API_KEY && !!process.env.GOOGLE_SEARCH_ENGINE_ID;
    
    logger.info('API status', { hasYelp, hasGoogle });
    
    // Get one lead for testing
    const leadResult = await query(`
      SELECT id, company_name, city, state 
      FROM leads 
      WHERE state = 'FL' 
      LIMIT 1
    `);
    
    if (leadResult.rows.length === 0) {
      return res.json({ success: false, error: 'No leads found for testing' });
    }
    
    const lead = leadResult.rows[0];
    logger.info('Testing with lead', { lead });
    
    // Test just Yelp service first
    if (hasYelp) {
      try {
        logger.info('Testing Yelp service');
        const YelpService = require('../services/yelpEnrichmentService');
        const yelpService = new YelpService();
        
        const yelpResult = await yelpService.enrichLead(lead.id);
        logger.info('Yelp test result', { yelpResult });
        
        return res.json({
          success: true,
          message: 'Yelp test completed',
          lead,
          yelpResult,
          hasYelp,
          hasGoogle
        });
      } catch (yelpError) {
        logger.error('Yelp test failed', { error: yelpError.message });
        return res.json({
          success: false,
          error: `Yelp test failed: ${yelpError.message}`,
          lead,
          hasYelp,
          hasGoogle
        });
      }
    }
    
    return res.json({
      success: false,
      error: 'No API keys configured for testing',
      hasYelp,
      hasGoogle
    });
    
  } catch (err) {
    logger.error('Test enrichment error', { error: err.message, stack: err.stack });
    res.status(500).json({ success: false, error: err.message });
  }
});

// Helper methods for mock data
router.generateMockPhone = function() {
  const areaCodes = ['305', '321', '352', '386', '407', '561', '727', '754', '786', '813', '850', '863', '904', '941', '954'];
  const areaCode = areaCodes[Math.floor(Math.random() * areaCodes.length)];
  const number = Math.floor(Math.random() * 9000000) + 1000000;
  return `+1${areaCode}${number}`;
};

router.generateMockEmail = function(companyName) {
  const domains = ['gmail.com', 'yahoo.com', 'outlook.com', 'company.com'];
  const cleanName = companyName.toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .substring(0, 10);
  const domain = domains[Math.floor(Math.random() * domains.length)];
  return `info@${cleanName}.com`;
};

router.generateMockWebsite = function(companyName) {
  const cleanName = companyName.toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .substring(0, 15);
  return `https://www.${cleanName}.com`;
};

module.exports = router;
