// app.js
const express = require('express');
const bodyParser = require('body-parser');
const config = require('./config');
const connectDB = require('./config/db');
const logger = require('./utils/logger');
const webhookRoutes = require('./routes/webhookRoutes'); // Will create this next

//const errorHandler = require('./middlewares/errorHandler'); // Will create this later


const requestLogger = require('./middlewares/requestLogger'); // Will create this next

const app = express();

// Connect to MongoDB
connectDB();

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(requestLogger); // Custom request logging middleware

// Routes
app.use('/webhook', webhookRoutes);

// Root route for health check
app.get('/', (req, res) => {
    res.status(200).send('WhatsApp Booking Service is running!');
});

// Global error handler (always last middleware)
// app.use(errorHandler); // Implement this later in Phase 4

// Start the server
const PORT = config.port;
app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT} in ${config.env} mode.`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', { promise, reason });
    // Application specific logging, throwing an error, or other logic here
    // Consider graceful shutdown if critical
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', { error });
    // Critical error, exit gracefully after logging
    process.exit(1);
});

module.exports = app; // For testing purposes
