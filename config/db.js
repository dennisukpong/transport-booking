// config/db.js
const mongoose = require('mongoose');
const config = require('./index');
const logger = require('../utils/logger'); // Import the logger

const connectDB = async () => {
    try {
        await mongoose.connect(config.mongoURI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            // useCreateIndex: true, // Deprecated in Mongoose 6+
            // useFindAndModify: false // Deprecated in Mongoose 6+
        });
        logger.info('MongoDB connected successfully.');
    } catch (err) {
        logger.error(`MongoDB connection error: ${err.message}`, { error: err });
        // Exit process with failure
        process.exit(1);
    }
};

module.exports = connectDB;
