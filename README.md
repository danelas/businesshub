# LLC Lead Generator & Outreach System

A comprehensive automated lead generation and outreach system for newly registered LLCs. This system pulls LLC data from public sources, processes and segments leads, and sends personalized SMS/email messages with affiliate links.

## 🏗️ Architecture

```
┌─────────────────────┐       ┌─────────────────────┐       ┌──────────────────────┐
│  Public LLC Data    │       │   Render Web        │       │  Affiliate Programs  │
│  (State Registry)   │ ────► │   Service / API     │ ◄───► │  (EIN, Banking,      │
└─────────────────────┘       │ - Node.js / Express │       │   Accounting, etc.)  │
                              │ - Handles API       │       └──────────────────────┘
                              │   requests &        │
                              │   automation        │
                              └─────────────────────┘
                                        │
                                        ▼
┌─────────────────────┐       ┌─────────────────────┐
│   SMS / Email       │       │   Postgres DB       │
│   Providers         │ ◄───► │ (Leads + Messages)  │
│ - TextMagic (SMS)   │       │                     │
│ - SendGrid (Email)  │       └─────────────────────┘
└─────────────────────┘                 ▲
          ▲                             │
          │                             ▼
┌─────────────────────┐       ┌─────────────────────┐
│ Cron Job / Worker   │       │   Data Import       │
│ - Daily / hourly    │       │ - CSV files         │
│ - Checks DB         │       │ - State APIs        │
│ - Sends messages    │       │ - Deduplication     │
│ - Updates status    │       │ - Validation        │
└─────────────────────┘       └─────────────────────┘
```

## 🚀 Features

### Data Ingestion
- **CSV Import**: Upload and process CSV files with LLC data
- **API Integration**: Pull data from state registry APIs
- **Deduplication**: Automatic duplicate detection and removal
- **Data Validation**: Clean and validate lead information
- **Batch Processing**: Handle large datasets efficiently

### Lead Management
- **Advanced Filtering**: Filter by state, business type, registration date, etc.
- **Segmentation**: Create targeted segments for campaigns
- **Contact Validation**: Ensure phone/email availability
- **Status Tracking**: Track lead lifecycle and engagement

### Message Generation
- **Template System**: Customizable SMS and email templates
- **Personalization**: Dynamic content with lead-specific data
- **Affiliate Integration**: Automatic affiliate link insertion with tracking
- **A/B Testing**: Multiple template variations

### Automated Outreach
- **SMS via TextMagic**: Reliable SMS delivery with status tracking
- **Email via SendGrid**: Professional email delivery with analytics
- **Rate Limiting**: Respect daily/hourly sending limits
- **Opt-out Handling**: Automatic unsubscribe management
- **Delivery Tracking**: Real-time status updates

### Campaign Management
- **Campaign Creation**: Set up targeted outreach campaigns
- **Scheduling**: Control when campaigns run
- **Performance Tracking**: Monitor delivery rates and engagement
- **Budget Controls**: Set daily/hourly message limits

### Analytics & Reporting
- **Dashboard**: Real-time overview of system performance
- **Delivery Analytics**: Track message success rates
- **Revenue Estimates**: Calculate potential affiliate earnings
- **Segmentation Stats**: Understand your lead database

## 📋 Prerequisites

- Node.js 18+ 
- PostgreSQL 12+
- TextMagic account (for SMS)
- SendGrid account (for email)
- Render account (for deployment)

## 🛠️ Installation

### 1. Clone the Repository
```bash
git clone <repository-url>
cd llc-lead-generator
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Setup
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
```env
# Database
DATABASE_URL=postgresql://username:password@localhost:5432/llc_leads

# API Keys
TEXTMAGIC_USERNAME=your_textmagic_username
TEXTMAGIC_API_KEY=your_textmagic_api_key
SENDGRID_API_KEY=your_sendgrid_api_key

# Contact Info
FROM_EMAIL=noreply@yourdomain.com
FROM_PHONE=+1234567890

# Affiliate Links
EIN_AFFILIATE_URL=https://your-affiliate-link.com/ein
BANKING_AFFILIATE_URL=https://your-affiliate-link.com/banking
ACCOUNTING_AFFILIATE_URL=https://your-affiliate-link.com/accounting
INSURANCE_AFFILIATE_URL=https://your-affiliate-link.com/insurance
```

### 4. Database Setup
```bash
# Create database
createdb llc_leads

# Run migrations
npm run migrate
```

### 5. Start the Application
```bash
# Development
npm run dev

# Production
npm start

# Worker (separate process)
npm run worker
```

## 📊 Usage

### Data Import

#### CSV Import
```bash
# Import from CSV file
node src/scripts/ingestData.js --file ./data/california_llcs.csv --source ca_state_registry

# With custom source identifier
node src/scripts/ingestData.js --file ./data/leads.csv --source manual_import
```

#### API Import
```bash
# Import from state API
node src/scripts/ingestData.js --api https://api.example.com/llcs --state CA --key YOUR_API_KEY
```

#### Via Web API
```bash
# Upload CSV via API
curl -X POST http://localhost:3000/api/leads/import/csv \
  -F "file=@leads.csv" \
  -F "source=manual_upload"

# Import from API endpoint
curl -X POST http://localhost:3000/api/leads/import/api \
  -H "Content-Type: application/json" \
  -d '{
    "apiUrl": "https://api.example.com/llcs",
    "stateCode": "CA",
    "apiKey": "your-key",
    "source": "ca_api"
  }'
```

### Campaign Management

#### Create Campaign
```bash
curl -X POST http://localhost:3000/api/campaigns \
  -H "Content-Type: application/json" \
  -d '{
    "name": "New LLC Welcome Campaign",
    "messageType": "email",
    "targetStates": ["CA", "TX", "NY"],
    "dailyLimit": 100,
    "hourlyLimit": 10
  }'
```

#### Start Campaign
```bash
curl -X POST http://localhost:3000/api/campaigns/{campaign-id}/start
```

### Message Templates

#### Create Template
```bash
curl -X POST http://localhost:3000/api/admin/templates \
  -H "Content-Type: application/json" \
  -d '{
    "name": "welcome_sms_v2",
    "type": "sms",
    "content": "Hi {{company_name}}! Congrats on your LLC! Get your EIN fast: {{ein_link}} Reply STOP to opt out.",
    "variables": ["company_name", "ein_link"]
  }'
```

## 🔧 API Endpoints

### Leads
- `GET /api/leads` - List leads with filtering
- `GET /api/leads/:id` - Get single lead
- `PUT /api/leads/:id` - Update lead
- `DELETE /api/leads/:id` - Delete lead
- `POST /api/leads/import/csv` - Import from CSV
- `POST /api/leads/import/api` - Import from API
- `POST /api/leads/deduplicate` - Remove duplicates

### Messages
- `GET /api/messages` - List messages
- `POST /api/messages/create` - Create message
- `POST /api/messages/:id/send` - Send single message
- `POST /api/messages/send-bulk` - Send bulk messages
- `GET /api/messages/:id/status` - Check delivery status

### Campaigns
- `GET /api/campaigns` - List campaigns
- `POST /api/campaigns` - Create campaign
- `PUT /api/campaigns/:id` - Update campaign
- `POST /api/campaigns/:id/start` - Start campaign
- `POST /api/campaigns/:id/stop` - Stop campaign
- `GET /api/campaigns/:id/metrics` - Get performance metrics

### Statistics
- `GET /api/stats/dashboard` - Dashboard overview
- `GET /api/stats/leads/by-state` - Lead distribution by state
- `GET /api/stats/messages/performance` - Message performance over time
- `GET /api/stats/campaigns/performance` - Campaign comparison

### Admin
- `GET /api/admin/templates` - List message templates
- `POST /api/admin/templates` - Create template
- `PUT /api/admin/templates/:id` - Update template
- `GET /api/admin/settings` - Get system settings
- `PUT /api/admin/settings/:key` - Update setting

## 🚀 Deployment

### Render Deployment

1. **Connect Repository**: Link your GitHub repository to Render

2. **Environment Variables**: Set in Render dashboard:
   ```
   NODE_ENV=production
   TEXTMAGIC_USERNAME=your_username
   TEXTMAGIC_API_KEY=your_api_key
   SENDGRID_API_KEY=your_sendgrid_key
   FROM_EMAIL=noreply@yourdomain.com
   FROM_PHONE=+1234567890
   EIN_AFFILIATE_URL=your_affiliate_url
   BANKING_AFFILIATE_URL=your_banking_url
   ACCOUNTING_AFFILIATE_URL=your_accounting_url
   INSURANCE_AFFILIATE_URL=your_insurance_url
   ```

3. **Database**: Create PostgreSQL database in Render

4. **Deploy**: Use the included `render.yaml` for automatic deployment

### Docker Deployment

```bash
# Build image
docker build -t llc-lead-generator .

# Run with environment file
docker run --env-file .env -p 3000:3000 llc-lead-generator
```

## 📈 Monitoring

### Health Check
```bash
curl http://localhost:3000/health
```

### System Status
```bash
curl http://localhost:3000/api/stats/system/health
```

### Worker Status
The message worker provides automatic:
- Rate limit enforcement
- Message queue processing
- Campaign automation
- Health monitoring
- Error recovery

## 🔒 Security

- **Environment Variables**: Never commit API keys
- **Rate Limiting**: Built-in protection against abuse
- **Input Validation**: All inputs are validated and sanitized
- **SQL Injection Protection**: Parameterized queries only
- **Opt-out Compliance**: Automatic unsubscribe handling

## 🛡️ Compliance

### CAN-SPAM Compliance
- Clear sender identification
- Truthful subject lines
- Easy unsubscribe mechanism
- Physical address in emails
- Prompt opt-out processing

### TCPA Compliance
- Opt-out keyword handling (STOP, UNSUBSCRIBE)
- Time-based sending restrictions
- Clear identification in messages
- Consent tracking

## 🔧 Configuration

### Message Limits
```javascript
// System settings (configurable via API)
{
  "daily_message_limit": "1000",
  "hourly_message_limit": "100",
  "message_delay_seconds": "5",
  "auto_campaign_enabled": "true"
}
```

### Template Variables
Available in all templates:
- `{{company_name}}` - Company name
- `{{state}}` - State code
- `{{business_type}}` - Business type
- `{{registration_date}}` - Registration date
- `{{ein_link}}` - EIN affiliate link
- `{{banking_link}}` - Banking affiliate link
- `{{accounting_link}}` - Accounting affiliate link
- `{{insurance_link}}` - Insurance affiliate link
- `{{unsubscribe_link}}` - Unsubscribe URL

## 🐛 Troubleshooting

### Common Issues

**Database Connection Failed**
```bash
# Check database URL
echo $DATABASE_URL

# Test connection
npm run migrate
```

**Messages Not Sending**
```bash
# Check worker status
curl http://localhost:3000/api/stats/system/health

# Restart worker
npm run worker
```

**High Error Rates**
- Check API key validity
- Verify phone/email formats
- Review rate limits
- Check opt-out lists

### Logs
```bash
# Application logs
tail -f logs/database.log

# Worker logs
tail -f logs/worker.log
```

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📞 Support

For support and questions:
- Create an issue in the repository
- Check the troubleshooting section
- Review the API documentation

## 🔄 Updates

### Version 1.0.0
- Initial release
- Full CRUD operations for leads
- SMS and email messaging
- Campaign management
- Analytics dashboard
- Render deployment support
