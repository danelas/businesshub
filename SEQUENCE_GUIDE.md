# LLC Sequence Campaign Guide

This guide explains how to use the automated LLC follow-up sequence system with your ready-to-send message templates.

## 🎯 Sequence Overview

The system includes a 5-step automated follow-up sequence for new LLCs:

| Day | Focus | Purpose |
|-----|-------|---------|
| **Day 1** | EIN / Tax ID | Welcome message with EIN setup |
| **Day 3-5** | Business Banking | Bank account opening guidance |
| **Day 7-10** | Accounting/Bookkeeping | Financial management setup |
| **Day 10-14** | Registered Agent/Compliance | Legal compliance requirements |
| **Day 15+** | Business Insurance | Protection and risk management |

## 🚀 Quick Start

### 1. Load the Message Templates
```bash
# Load all ready-to-send templates
npm run load-templates
```

This will install all 10 templates (5 SMS + 5 Email) with your provided copy.

### 2. Create a Sequence Campaign
```bash
# Create an email sequence for all states
curl -X POST http://localhost:3000/api/sequences/llc-sequence \
  -H "Content-Type: application/json" \
  -d '{
    "name": "LLC Welcome Email Sequence",
    "messageType": "email",
    "targetStates": [],
    "maxRegistrationDays": 30,
    "dailyLimit": 100,
    "hourlyLimit": 20
  }'

# Create an SMS sequence for specific states
curl -X POST http://localhost:3000/api/sequences/llc-sequence \
  -H "Content-Type: application/json" \
  -d '{
    "name": "LLC Welcome SMS Sequence - CA/TX/NY",
    "messageType": "sms",
    "targetStates": ["CA", "TX", "NY"],
    "maxRegistrationDays": 14,
    "dailyLimit": 50,
    "hourlyLimit": 10
  }'
```

### 3. Import LLC Data with Registration Dates
```bash
# Import CSV with registration_date column
npm run ingest -- --file ./data/new_llcs.csv --source state_registry

# The CSV should include columns like:
# company_name, state, registration_date, phone, email, address_line1, city, zip_code
```

### 4. Start the Worker
```bash
# Start the background worker (processes sequences automatically)
npm run worker
```

## 📧 Template Details

### Day 1 - EIN / Tax ID
**SMS Template:** `llc_day1_ein_sms`
```
Congrats on forming {{company_name}}! Based on your {{business_type}}, you'll need an EIN for taxes and banking. Get yours quickly here: {{ein_link}}. Reply STOP to opt out.
```

**Email Template:** `llc_day1_ein_email`
```
Subject: {{company_name}}: Your Next Step After LLC Formation

Hi {{owner_name}},

Congratulations on registering your {{business_type}}! Based on your business type, we recommend getting your EIN immediately as it's required for taxes, banking, and hiring employees.

{{business_recommendation}}

Get your EIN easily through our trusted partner: {{ein_link}}

—
If you'd rather not receive these emails, unsubscribe here: {{unsubscribe_link}}
```

### Day 3-5 - Business Banking
**SMS Template:** `llc_day3_banking_sms`
```
Hey {{company_name}} owner! Based on your {{business_type}}, we recommend opening a business bank account now. {{banking_recommendation}} Start here: {{banking_link}}. Reply STOP to unsubscribe.
```

**Email Template:** `llc_day3_banking_email`
```
Subject: Set Up Your Business Bank Account Easily

Hi {{owner_name}},

Your new {{business_type}} is ready! Based on your business type, we recommend setting up proper financial separation immediately.

{{banking_recommendation}}

Our partners make it simple: {{banking_link}}

—
Unsubscribe anytime: {{unsubscribe_link}}
```

### Day 7-10 - Accounting / Bookkeeping
**SMS Template:** `llc_day7_accounting_sms`
```
{{company_name}} is ready to grow! Based on your {{business_type}}, we recommend professional bookkeeping. {{accounting_recommendation}} Get started: {{accounting_link}}. Reply STOP to unsubscribe.
```

**Email Template:** `llc_day7_accounting_email`
```
Subject: Keep Your LLC Finances Organized

Hi {{owner_name}},

Congrats on getting your EIN and bank account! Based on your {{business_type}}, proper accounting is crucial for your success.

{{accounting_recommendation}}

Simplify accounting with our recommended service: {{accounting_link}}. Avoid headaches and stay compliant.

—
To stop receiving messages, click here: {{unsubscribe_link}}
```

### Day 10-14 - Registered Agent / Compliance
**SMS Template:** `llc_day10_compliance_sms`
```
Reminder: Based on your {{business_type}}, you need a registered agent to stay compliant. {{compliance_recommendation}} Secure one here: {{compliance_link}}. Reply STOP to unsubscribe.
```

**Email Template:** `llc_day10_compliance_email`
```
Subject: Ensure Your LLC Stays Compliant

Hi {{owner_name}},

Based on your {{business_type}}, maintaining compliance is essential for legal protection.

{{compliance_recommendation}}

A registered agent ensures your LLC receives legal documents on time. Protect your business today with {{compliance_link}}.

—
Unsubscribe anytime: {{unsubscribe_link}}
```

### Day 15+ - Business Insurance
**SMS Template:** `llc_day15_insurance_sms`
```
Protect {{company_name}} with business insurance today. Based on your {{business_type}}, {{insurance_recommendation}} Get quotes: {{insurance_link}}. Reply STOP to unsubscribe.
```

**Email Template:** `llc_day15_insurance_email`
```
Subject: Safeguard Your New LLC

Hi {{owner_name}},

Based on your {{business_type}}, proper insurance coverage is essential for protecting your investment.

{{insurance_recommendation}}

Compare insurance options quickly through our trusted partner: {{insurance_link}}.

—
Unsubscribe here: {{unsubscribe_link}}
```

## 🔧 API Usage

### Check Sequence Progress
```bash
# Get progress for a specific lead
curl http://localhost:3000/api/sequences/progress/{leadId}/{campaignId}
```

### Get Sequence Statistics
```bash
# Get performance stats for a campaign
curl http://localhost:3000/api/sequences/stats/{campaignId}?days=30
```

### Manual Sequence Generation
```bash
# Generate sequence messages for a specific lead
curl -X POST http://localhost:3000/api/sequences/generate/{leadId} \
  -H "Content-Type: application/json" \
  -d '{
    "campaignId": "campaign-uuid",
    "messageType": "email"
  }'
```

### Process All Sequences
```bash
# Manually trigger sequence processing
curl -X POST http://localhost:3000/api/sequences/process \
  -H "Content-Type: application/json" \
  -d '{"limit": 100}'
```

## 📊 Monitoring & Analytics

### Dashboard Overview
```bash
curl http://localhost:3000/api/stats/dashboard
```

### Sequence-Specific Stats
```bash
curl http://localhost:3000/api/sequences/stats/{campaignId}
```

### Lead Progress Tracking
```bash
curl http://localhost:3000/api/sequences/leads?campaignId={id}&page=1&limit=50
```

## ⚙️ Configuration

### Environment Variables
```env
# Required for sequence campaigns
EIN_AFFILIATE_URL=https://your-ein-partner.com/signup?ref=llc
BANKING_AFFILIATE_URL=https://your-bank-partner.com/business?ref=llc
ACCOUNTING_AFFILIATE_URL=https://your-accounting-partner.com/signup?ref=llc
INSURANCE_AFFILIATE_URL=https://your-insurance-partner.com/quote?ref=llc
COMPLIANCE_AFFILIATE_URL=https://your-compliance-partner.com/agent?ref=llc
UNSUBSCRIBE_URL=https://yourdomain.com/unsubscribe
```

### Sequence Timing
The system automatically calculates when to send each message based on the LLC's `registration_date`:

- **Day 1**: Sent immediately if registration_date is today or in the past
- **Day 3**: Sent 3 days after registration_date
- **Day 7**: Sent 7 days after registration_date
- **Day 10**: Sent 10 days after registration_date
- **Day 15**: Sent 15 days after registration_date

### Rate Limiting
Each sequence campaign respects:
- Daily message limits (default: 100/day)
- Hourly message limits (default: 20/hour)
- Global system limits
- Opt-out lists

## 🎯 Best Practices

### 1. Data Quality
- Ensure `registration_date` is accurate and recent
- Validate phone numbers for SMS campaigns
- Verify email addresses for email campaigns
- Include business owner names when possible

### 2. Campaign Setup
- Start with email sequences (higher deliverability)
- Use SMS for high-value, time-sensitive messages
- Target specific states based on your affiliate partnerships
- Set conservative daily limits initially

### 3. Monitoring
- Check sequence statistics daily
- Monitor opt-out rates by template
- Track affiliate link click-through rates
- Adjust timing based on performance

### 4. Compliance
- All templates include opt-out instructions
- System automatically handles STOP replies
- Unsubscribe links are automatically generated
- Opt-out lists are respected across all campaigns

## 🚨 Troubleshooting

### Templates Not Loading
```bash
# Check if templates exist
curl http://localhost:3000/api/admin/templates | grep llc_day

# Reload templates
npm run load-templates
```

### Sequences Not Processing
```bash
# Check worker status
curl http://localhost:3000/api/stats/system/health

# Manually process sequences
curl -X POST http://localhost:3000/api/sequences/process
```

### Messages Not Sending
```bash
# Check message queue
curl http://localhost:3000/api/messages?status=pending&limit=10

# Check rate limits
curl http://localhost:3000/api/stats/dashboard
```

### Low Delivery Rates
1. Verify API keys (TextMagic, SendGrid)
2. Check phone/email format validation
3. Review opt-out lists
4. Monitor bounce rates

## 📈 Expected Performance

With proper setup, you can expect:
- **Email Delivery Rate**: 95-98%
- **SMS Delivery Rate**: 98-99%
- **Opt-out Rate**: 2-5% (varies by industry)
- **Processing Speed**: 100+ leads/hour
- **Sequence Completion**: 80-90% of eligible leads

## 🔄 Automation Flow

1. **Data Import**: New LLCs imported with registration dates
2. **Sequence Detection**: Worker identifies leads eligible for sequences
3. **Message Generation**: Templates populated with lead data
4. **Queue Management**: Messages added to sending queue
5. **Delivery**: SMS/Email sent via providers
6. **Tracking**: Delivery status monitored and updated
7. **Progression**: Next sequence step scheduled automatically

The system runs continuously, processing new leads and advancing existing ones through the sequence based on their registration timeline.
