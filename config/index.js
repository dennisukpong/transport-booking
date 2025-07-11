// config/index.js
require('dotenv').config();

module.exports = {
    port: process.env.PORT || 3000,
    mongoURI: process.env.MONGO_URI || 'mongodb://localhost:27017/whatsapp_booking_db',
    twilio: {
        accountSid: process.env.TWILIO_ACCOUNT_SID,
        authToken: process.env.TWILIO_AUTH_TOKEN,
        whatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER // Your Twilio WhatsApp number
    },
    // Add other configurations here
    env: process.env.NODE_ENV || 'development'
};
