require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const { testConnection, closePool, logger } = require('./database/connection');

// Import routes
const leadsRoutes = require('./routes/leads');
const messagesRoutes = require('./routes/messages');
const campaignsRoutes = require('./routes/campaigns');
const sequencesRoutes = require('./routes/sequences');
const floridaRoutes = require('./routes/florida');
const webhooksRoutes = require('./routes/webhooks');
const statsRoutes = require('./routes/stats');
const adminRoutes = require('./routes/admin');
const testRoutes = require('./routes/test');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const dbConnected = await testConnection();
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: dbConnected ? 'connected' : 'disconnected',
      version: process.env.npm_package_version || '1.0.0'
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// API Routes
app.use('/api/leads', leadsRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/campaigns', campaignsRoutes);
app.use('/api/sequences', sequencesRoutes);
app.use('/api/florida', floridaRoutes);
app.use('/api/webhooks', webhooksRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/test', testRoutes);

// Serve static files for unsubscribe pages
app.use('/static', express.static(path.join(__dirname, 'public')));

// Unsubscribe page
app.get('/unsubscribe', (req, res) => {
  const { lead, type } = req.query;
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Unsubscribe - LLC Business Resources</title>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
        .container { text-align: center; }
        .success { color: #28a745; }
        .error { color: #dc3545; }
        button { background-color: #dc3545; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; }
        button:hover { background-color: #c82333; }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>Unsubscribe from LLC Business Resources</h2>
        <p>We're sorry to see you go. Click the button below to unsubscribe from ${type || 'all'} communications.</p>
        <button onclick="unsubscribe()">Unsubscribe</button>
        <div id="message"></div>
      </div>
      <script>
        async function unsubscribe() {
          try {
            const response = await fetch('/api/webhooks/unsubscribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ lead: '${lead}', type: '${type}' })
            });
            const result = await response.json();
            document.getElementById('message').innerHTML = 
              '<p class="success">You have been successfully unsubscribed.</p>';
          } catch (err) {
            document.getElementById('message').innerHTML = 
              '<p class="error">An error occurred. Please try again.</p>';
          }
        }
      </script>
    </body>
    </html>
  `);
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'The requested resource was not found',
    path: req.originalUrl
  });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { 
    error: err.message, 
    stack: err.stack, 
    url: req.url, 
    method: req.method 
  });
  
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await closePool();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await closePool();
  process.exit(0);
});

// Start server
const startServer = async () => {
  try {
    // Test database connection (but don't fail if it's not ready)
    const dbConnected = await testConnection();
    
    app.listen(PORT, () => {
      logger.info(`Server started on port ${PORT}`, {
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
        database: dbConnected ? 'connected' : 'disconnected'
      });
      
      if (!dbConnected) {
        logger.warn('Database not connected at startup. Will retry on requests.');
      }
    });
  } catch (err) {
    logger.error('Failed to start server', { error: err.message });
    
    // In production, try to start anyway (database might come online later)
    if (process.env.NODE_ENV === 'production') {
      logger.info('Starting server without database connection (production mode)');
      app.listen(PORT, () => {
        logger.info(`Server started on port ${PORT} (database disconnected)`);
      });
    } else {
      process.exit(1);
    }
  }
};

startServer();

module.exports = app;
