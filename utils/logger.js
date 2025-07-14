// utils/logger.js
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const config = require('../config'); // Assuming config.js pulls from .env

// Determine the desired log level from environment variables, default to 'info'
const consoleLogLevel = process.env.LOG_LEVEL || 'info'; // Use process.env.LOG_LEVEL
const fileLogLevel = process.env.FILE_LOG_LEVEL || 'info'; // Optional: separate level for files

// Define log formats
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }), // Include stack trace for errors
    winston.format.splat(), // For string interpolation
    winston.format.json() // Structured JSON logs for files, but not ideal for console
);

// Define console format for readability
const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(info => {
        // This format is more readable for console logs
        const levelPadding = info.level.padEnd(7);
        const message = typeof info.message === 'object' ? JSON.stringify(info.message) : info.message;
        // Check if there's a 'meta' object (the extra data passed to logger, e.g., logger.info('msg', {extra: 'data'}))
        const meta = Object.keys(info).filter(key => !['level', 'message', 'timestamp', 'stack'].includes(key))
                             .map(key => `${key}:${JSON.stringify(info[key])}`)
                             .join(' ');
        const stack = info.stack ? `\n${info.stack}` : '';
        return `${info.timestamp} ${levelPadding}: ${message} ${meta}${stack}`;
    })
);


// Define transports
const transports = [
    // Console output for Render logs
    new winston.transports.Console({
        format: consoleFormat, // Use the more readable console format
        level: consoleLogLevel, // <-- Use the dynamically determined level here
        handleExceptions: true // Ensure exceptions also go to console
    }),
    // File transport for general logs (often not needed on Render as console is primary)
    // If you enable this, ensure your Render service has disk persistence if you want to inspect files
    new DailyRotateFile({
        filename: 'logs/application-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '14d', // Keep logs for 14 days
        level: fileLogLevel, // Use dynamic level or keep 'info'
        format: logFormat // Use JSON format for files
    }),
    // File transport for error logs (also often not needed if console is robust)
    new DailyRotateFile({
        filename: 'logs/error-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '30d', // Keep error logs for 30 days
        level: 'error', // Always capture all errors to this file
        format: logFormat // Use JSON format for files
    })
];

const logger = winston.createLogger({
    // The logger's overall level should be the lowest (most verbose) of your transports,
    // or simply follow the consoleLogLevel for simplicity
    level: consoleLogLevel,
    format: logFormat, // This is applied *before* transports format
    transports: transports,
    exitOnError: false, // Do not exit on handled exceptions
});

// Stream for HTTP request logging (Morgan or custom middleware)
logger.stream = {
    write: function(message, encoding) {
        // We'll use this with a custom Express middleware to log HTTP requests
        // Ensure message.trim() if it contains newline at the end
        logger.info(message.trim());
    },
};

module.exports = logger;
