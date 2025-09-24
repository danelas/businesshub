# Florida LLC Data Integration Guide

This guide explains how to use the automated Florida LLC data ingestion and contact enrichment system.

## 🏛️ Overview

The Florida integration automatically:
1. **Downloads** daily LLC data from Florida Division of Corporations SFTP
2. **Filters** for recent LLC formations (last 1-7 days)
3. **Enriches** contact information through web scraping and business directories
4. **Integrates** with the sequence campaign system for automated outreach

## 🔧 Setup

### 1. Install Additional Dependencies
```bash
npm install ssh2-sftp-client cheerio
```

### 2. Set Up Florida Database Schema
```bash
# Set up Florida-specific tables
npm run setup-florida
```

### 3. Configure Environment (Optional)
The Florida SFTP credentials are already configured:
- **Host**: `sftp.floridados.gov`
- **Username**: `Public`
- **Password**: `PubAccess1845!`

## 🚀 Usage

### Manual Sync
```bash
# Full sync (download, process, and enrich contacts)
npm run florida-sync -- --enrich-contacts

# Download and process only (last 7 days)
npm run florida-sync

# Process only existing files (last 3 days)
npm run florida-sync -- --process-only --days-back 3

# Contact enrichment only
npm run florida-sync -- --process-only --enrich-contacts --enrich-limit 100

# List available files on SFTP
npm run florida-sync -- --list-files
```

### Automated Daily Sync
The worker automatically runs:
- **Daily at 6 AM**: Florida data sync (downloads and processes new LLCs)
- **Every 4 hours**: Contact enrichment for leads without phone/email

```bash
# Start the worker (includes Florida automation)
npm run worker
```

## 📊 API Endpoints

### Florida Statistics
```bash
# Get Florida LLC statistics
curl http://localhost:3000/api/florida/stats?days=30

# Get enrichment performance metrics
curl http://localhost:3000/api/florida/enrichment/performance?days=30
```

### File Management
```bash
# List available files on SFTP
curl http://localhost:3000/api/florida/files/available

# Get download history
curl http://localhost:3000/api/florida/files/downloads?page=1&limit=20
```

### Data Sync
```bash
# Trigger manual sync
curl -X POST http://localhost:3000/api/florida/sync \
  -H "Content-Type: application/json" \
  -d '{
    "daysBack": 7,
    "enrichContacts": true,
    "enrichLimit": 50
  }'
```

### Contact Enrichment
```bash
# Enrich specific lead
curl -X POST http://localhost:3000/api/florida/enrich/{leadId}

# Bulk enrich leads without contacts
curl -X POST http://localhost:3000/api/florida/enrich/bulk \
  -H "Content-Type: application/json" \
  -d '{"limit": 50}'

# Get leads needing enrichment
curl http://localhost:3000/api/florida/leads/need-enrichment?page=1&limit=50
```

### Recent LLCs
```bash
# Get recent Florida LLCs
curl http://localhost:3000/api/florida/leads/recent?days=7&hasContact=false

# Get recent LLCs with contact info
curl http://localhost:3000/api/florida/leads/recent?days=7&hasContact=true
```

## 🔍 Contact Enrichment Process

The system automatically finds contact information through:

### 1. Google Search
- Searches for `"Company Name" City contact phone`
- Extracts business website from search results
- Finds phone numbers in search snippets

### 2. Website Scraping
- Visits company website and common pages (`/contact`, `/about`)
- Extracts phone numbers and email addresses
- Respects robots.txt and rate limits

### 3. Business Directories
- **Yelp**: Business listings and contact info
- **Yellow Pages**: Phone directory searches
- **Better Business Bureau**: Business profiles
- **Manta**: Business directory listings

### 4. Data Cleaning
- Validates and formats phone numbers (US format)
- Filters out personal emails (Gmail, Yahoo, etc.)
- Removes duplicates and invalid contacts

## 📋 Data Fields

### Florida LLC Data Includes:
- **Company Name**: Business entity name
- **Registration Date**: LLC formation date
- **Business Type**: Entity type (LLC, PLLC, etc.)
- **Address**: Principal business address
- **Registered Agent**: Registered agent information
- **Officers**: Officer names and titles (when available)
- **Status**: Active, inactive, etc.

### Enriched Contact Data:
- **Phone**: Business phone number (US format)
- **Email**: Business email address
- **Website**: Company website URL
- **Contact Sources**: Which services found the contact info

## 🎯 Integration with Sequences

### Automatic Sequence Enrollment
New Florida LLCs are automatically eligible for sequence campaigns:

```bash
# Create Florida-specific sequence campaign
curl -X POST http://localhost:3000/api/sequences/llc-sequence \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Florida LLC Welcome Sequence",
    "messageType": "email",
    "targetStates": ["FL"],
    "maxRegistrationDays": 7,
    "dailyLimit": 100
  }'
```

### Sequence Timing
- **Day 1**: Welcome + EIN information (sent immediately for new LLCs)
- **Day 3**: Business banking setup
- **Day 7**: Accounting and bookkeeping
- **Day 10**: Compliance and registered agent
- **Day 15**: Business insurance

## 📈 Performance Monitoring

### Florida Statistics Dashboard
```bash
curl http://localhost:3000/api/florida/stats
```

**Response includes:**
- Daily LLC registrations
- Contact enrichment success rates
- Phone/email discovery rates
- Processing performance metrics

### Enrichment Performance
```bash
curl http://localhost:3000/api/florida/enrichment/performance
```

**Tracks:**
- Success rate by source (Google, Yelp, etc.)
- Average contacts found per lead
- Processing time per enrichment
- Daily performance trends

## ⚙️ Configuration

### Rate Limiting
The system includes built-in rate limiting:
- **2 seconds** between web requests
- **Maximum 3 retries** for failed requests
- **Respectful crawling** with proper user agents

### Filtering Options
```javascript
// Days back to process (default: 7)
daysBack: 7

// Enrichment batch size (default: 50)
enrichLimit: 50

// Business types to include
businessTypes: ['LLC', 'PLLC', 'LIMITED LIABILITY']
```

### Data Quality
- **Deduplication**: Automatic duplicate detection by company name + state
- **Validation**: Phone and email format validation
- **Filtering**: Excludes inactive/dissolved entities
- **Tracking**: Complete audit trail of all operations

## 🚨 Troubleshooting

### SFTP Connection Issues
```bash
# Test SFTP connection
npm run florida-sync -- --list-files
```

### No New Records Found
- Check if files are being downloaded: `/downloads/florida/`
- Verify date filtering: increase `--days-back` parameter
- Check import logs: `SELECT * FROM import_logs WHERE source = 'florida_sftp'`

### Contact Enrichment Failing
```bash
# Check enrichment logs
curl http://localhost:3000/api/florida/enrichment/performance

# Test single lead enrichment
curl -X POST http://localhost:3000/api/florida/enrich/{leadId}
```

### Low Contact Discovery Rates
- **Google blocking**: Reduce request frequency
- **Website changes**: Update scraping selectors
- **Directory access**: Check if business directories are accessible

## 📊 Expected Performance

With proper setup, expect:
- **Download Speed**: 5-10 files per sync
- **Processing Rate**: 1000+ records per minute
- **Contact Discovery**: 30-50% success rate
- **Phone Numbers**: 25-40% of leads
- **Email Addresses**: 15-30% of leads
- **Websites**: 40-60% of leads

## 🔄 Automation Schedule

### Daily Worker Tasks:
1. **6:00 AM**: Download and process new Florida LLC files
2. **Every 4 hours**: Enrich contacts for leads without phone/email
3. **Hourly**: Process sequence campaigns for new LLCs
4. **Every 5 minutes**: Send pending messages

### Manual Operations:
- **Weekly**: Review enrichment performance and adjust parameters
- **Monthly**: Clean up old download files and logs
- **As needed**: Process historical data or specific date ranges

## 🎯 Best Practices

### 1. Data Management
- Monitor daily sync results
- Review enrichment success rates
- Clean up old files regularly
- Backup important data

### 2. Contact Enrichment
- Start with small batches (25-50 leads)
- Monitor for IP blocking or rate limiting
- Verify contact quality regularly
- Respect website terms of service

### 3. Campaign Integration
- Create Florida-specific sequences
- Set appropriate daily limits
- Monitor opt-out rates
- Track conversion performance

### 4. Compliance
- Respect robots.txt files
- Use appropriate request delays
- Handle opt-outs promptly
- Maintain data privacy standards

The Florida integration provides a complete pipeline from raw state data to qualified leads ready for automated outreach campaigns.
