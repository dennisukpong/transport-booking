// utils/logger.js
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const config = require('../config');

// Define log formats
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }), // Include stack trace for errors
    winston.format.splat(), // For string interpolation
    winston.format.json() // Structured JSON logs
);

// Define transports
const transports = [
    // Console output for development
    new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        ),
        level: config.env === 'development' ? 'debug' : 'info' // More verbose in dev
    }),
    // File transport for general logs
    new DailyRotateFile({
        filename: 'logs/application-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '14d', // Keep logs for 14 days
        level: 'info'
    }),
    // File transport for error logs
    new DailyRotateFile({
        filename: 'logs/error-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '30d', // Keep error logs for 30 days
        level: 'error'
    })
];

const logger = winston.createLogger({
    format: logFormat,
    transports: transports,
    exitOnError: false, // Do not exit on handled exceptions
});

// Stream for HTTP request logging (Morgan or custom middleware)
logger.stream = {
    write: function(message, encoding) {
        // We'll use this with a custom Express middleware to log HTTP requests
        logger.info(message.trim());
    },
};

module.exports = logger;
