// middlewares/requestLogger.js
const logger = require('../utils/logger');

const requestLogger = (req, res, next) => {
    logger.info(`Incoming Request: ${req.method} ${req.originalUrl}`, {
        method: req.method,
        url: req.originalUrl,
        ip: req.ip,
        headers: req.headers // Be cautious with logging sensitive headers
    });
    next();
};

module.exports = requestLogger;
