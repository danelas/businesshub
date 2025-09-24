# 🚀 Complete Setup Guide

This guide covers all the APIs, services, and environment variables you need to get the LLC Lead Generator system running.

## 📋 Prerequisites

### 1. **PostgreSQL Database**
- **Local**: Install PostgreSQL 12+ 
- **Cloud**: Use services like:
  - [Render PostgreSQL](https://render.com/docs/databases) (Recommended for deployment)
  - [Supabase](https://supabase.com/) (Free tier available)
  - [AWS RDS](https://aws.amazon.com/rds/)
  - [Google Cloud SQL](https://cloud.google.com/sql)

### 2. **Node.js**
- Install Node.js 16+ from [nodejs.org](https://nodejs.org/)

## 🔑 Required API Keys & Services

### 1. **SMS Service - TextMagic** (Required for SMS)
- **Website**: [textmagic.com](https://www.textmagic.com/)
- **Cost**: ~$0.04 per SMS
- **Setup**:
  1. Create account at textmagic.com
  2. Go to Settings → API Keys
  3. Generate new API key
  4. Note your username and API key

**Environment Variables:**
```bash
TEXTMAGIC_USERNAME=your_username
TEXTMAGIC_API_KEY=tm-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
FROM_PHONE=+1234567890  # Your TextMagic phone number
```

### 2. **Email Service - SendGrid** (Required for Email)
- **Website**: [sendgrid.com](https://sendgrid.com/)
- **Cost**: Free tier (100 emails/day), then ~$0.0006 per email
- **Setup**:
  1. Create account at sendgrid.com
  2. Go to Settings → API Keys
  3. Create new API key with "Full Access"
  4. Verify sender identity (email/domain)

**Environment Variables:**
```bash
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
FROM_EMAIL=noreply@yourdomain.com  # Must be verified in SendGrid
```

### 3. **Affiliate Program URLs** (Required for Revenue)
You'll need affiliate links for each service you're promoting:

#### **EIN Services:**
- [Northwest Registered Agent](https://www.northwestregisteredagent.com/affiliate-program)
- [LegalZoom](https://www.legalzoom.com/affiliates)
- [IncFile](https://www.incfile.com/affiliate-program/)

#### **Banking Services:**
- [Novo Bank](https://www.novo.co/partners)
- [Mercury Bank](https://mercury.com/partners)
- [Chase Business](https://www.chase.com/business/banking/affiliate-program)

#### **Accounting Services:**
- [QuickBooks](https://quickbooks.intuit.com/partners/)
- [FreshBooks](https://www.freshbooks.com/partners)
- [Xero](https://www.xero.com/us/partners/)

#### **Insurance Services:**
- [Next Insurance](https://www.nextinsurance.com/partners/)
- [Hiscox](https://www.hiscox.com/partners)
- [Simply Business](https://www.simplybusiness.com/partners/)

**Environment Variables:**
```bash
EIN_AFFILIATE_URL=https://your-affiliate-link.com/ein?ref=your_id
BANKING_AFFILIATE_URL=https://your-affiliate-link.com/banking?ref=your_id
ACCOUNTING_AFFILIATE_URL=https://your-affiliate-link.com/accounting?ref=your_id
INSURANCE_AFFILIATE_URL=https://your-affiliate-link.com/insurance?ref=your_id
COMPLIANCE_AFFILIATE_URL=https://your-affiliate-link.com/compliance?ref=your_id
```

## 🗄️ Database Setup

### **Option 1: Local PostgreSQL**
```bash
# Install PostgreSQL (Windows)
# Download from: https://www.postgresql.org/download/windows/

# Create database
createdb llc_leads

# Environment variables
DATABASE_URL=postgresql://username:password@localhost:5432/llc_leads
DB_HOST=localhost
DB_PORT=5432
DB_NAME=llc_leads
DB_USER=your_username
DB_PASSWORD=your_password
```

### **Option 2: Render PostgreSQL** (Recommended)
```bash
# 1. Go to render.com → Create → PostgreSQL
# 2. Choose plan (free tier available)
# 3. Copy connection details

# Environment variables (provided by Render)
DATABASE_URL=postgresql://user:pass@hostname:5432/database_name
```

## 🌐 Florida Data Access (No API Key Required!)

The Florida Division of Corporations provides **free public access** to LLC data:

```bash
# Already configured - no setup needed!
FLORIDA_SFTP_HOST=sftp.floridados.gov
FLORIDA_SFTP_USERNAME=Public
FLORIDA_SFTP_PASSWORD=PubAccess1845!
FLORIDA_SFTP_PORT=22
```

## ⚙️ Complete Environment Configuration

Create your `.env` file:

```bash
# Copy the example file
cp .env.example .env
```

Edit `.env` with your actual values:

```bash
# Database Configuration
DATABASE_URL=postgresql://username:password@localhost:5432/llc_leads
DB_HOST=localhost
DB_PORT=5432
DB_NAME=llc_leads
DB_USER=username
DB_PASSWORD=password

# Server Configuration
PORT=3000
NODE_ENV=development

# API Keys (REQUIRED)
TEXTMAGIC_USERNAME=your_textmagic_username
TEXTMAGIC_API_KEY=tm-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# JWT Secret (Generate a random string)
JWT_SECRET=your_super_secret_jwt_key_here_make_it_long_and_random

# Message Configuration
FROM_EMAIL=noreply@yourdomain.com
FROM_PHONE=+1234567890
DAILY_MESSAGE_LIMIT=1000
HOURLY_MESSAGE_LIMIT=100

# Affiliate Program URLs (REQUIRED FOR REVENUE)
EIN_AFFILIATE_URL=https://your-affiliate-link.com/ein
BANKING_AFFILIATE_URL=https://your-affiliate-link.com/banking
ACCOUNTING_AFFILIATE_URL=https://your-affiliate-link.com/accounting
INSURANCE_AFFILIATE_URL=https://your-affiliate-link.com/insurance
COMPLIANCE_AFFILIATE_URL=https://your-affiliate-link.com/compliance

# Unsubscribe URL
UNSUBSCRIBE_URL=http://localhost:3000/unsubscribe

# Contact Enrichment Configuration
GOOGLE_SEARCH_DELAY=2000
ENRICHMENT_MAX_RETRIES=3
ENRICHMENT_TIMEOUT=10000

# Florida SFTP Configuration (Public Access - No Changes Needed)
FLORIDA_SFTP_HOST=sftp.floridados.gov
FLORIDA_SFTP_USERNAME=Public
FLORIDA_SFTP_PASSWORD=PubAccess1845!
FLORIDA_SFTP_PORT=22

# Web Scraping Configuration
USER_AGENT=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36
REQUEST_DELAY=2000
MAX_REDIRECTS=5
```

## 🛠️ Installation Steps

### 1. **Install Dependencies**
```bash
npm install
```

### 2. **Set Up Database**
```bash
# Run migrations to create tables
npm run migrate

# Set up Florida-specific tables
npm run setup-florida

# Load message templates
npm run load-templates
```

### 3. **Test the Setup**
```bash
# Test Florida pipeline
npm run test-florida

# Test basic functionality
npm run dev
```

## 💰 Cost Breakdown

### **Monthly Operating Costs** (for 10,000 leads/month):

| Service | Cost | Notes |
|---------|------|-------|
| **TextMagic SMS** | $400 | ~$0.04 per SMS × 10,000 |
| **SendGrid Email** | $15 | Pro plan for high volume |
| **Render Hosting** | $7 | Starter plan |
| **Render PostgreSQL** | $7 | Starter database |
| **Total** | **~$429/month** | |

### **Revenue Potential** (10,000 leads/month):
- **EIN Services**: $25-50 per conversion × 2-5% = $500-2,500
- **Banking**: $50-100 per conversion × 1-3% = $500-3,000  
- **Accounting**: $30-75 per conversion × 2-4% = $600-3,000
- **Insurance**: $100-300 per conversion × 1-2% = $1,000-6,000

**Potential Monthly Revenue**: $2,600 - $14,500

## 🔒 Security & Compliance

### **Required for Production:**

1. **Domain Verification**:
   - Verify your sending domain in SendGrid
   - Set up SPF, DKIM, and DMARC records

2. **SSL Certificate**:
   - Use HTTPS for all web traffic
   - Render provides free SSL certificates

3. **Opt-out Compliance**:
   - System includes automatic opt-out handling
   - Required by CAN-SPAM Act and TCPA

4. **Data Protection**:
   - Database encryption at rest
   - Secure API key storage
   - Regular backups

## 🚀 Quick Start Commands

```bash
# 1. Clone and install
git clone <your-repo>
cd llc-lead-generator
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env with your API keys

# 3. Set up database
npm run migrate
npm run setup-florida
npm run load-templates

# 4. Test the system
npm run test-florida

# 5. Start development server
npm run dev

# 6. Start background worker (for automation)
npm run worker
```

## 🆘 Troubleshooting

### **Common Issues:**

1. **Database Connection Failed**
   - Check PostgreSQL is running
   - Verify DATABASE_URL format
   - Ensure database exists

2. **SMS/Email Not Sending**
   - Verify API keys are correct
   - Check FROM_PHONE/FROM_EMAIL are verified
   - Review daily/hourly limits

3. **Florida SFTP Connection Failed**
   - Check internet connection
   - Verify firewall allows SFTP (port 22)
   - Try different network if corporate firewall blocks

4. **Contact Enrichment Not Working**
   - Reduce GOOGLE_SEARCH_DELAY if too slow
   - Check for IP rate limiting
   - Verify USER_AGENT string

### **Getting Help:**

- Check logs in `logs/` directory
- Use `npm run test-florida` to diagnose issues
- Monitor API endpoints for error details

## 🎯 Next Steps

1. **Set up affiliate accounts** and get your tracking URLs
2. **Configure SendGrid** with your domain
3. **Test with small batches** before scaling up
4. **Monitor performance** and adjust limits as needed
5. **Deploy to production** using Render or similar service

The system is designed to be profitable from day one with proper affiliate partnerships!
