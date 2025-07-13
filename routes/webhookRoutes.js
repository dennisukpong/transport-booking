// routes/webhookRoutes.js
const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const whatsappService = require('../services/whatsappService');
const twilio = require('twilio'); // Make sure you have this import for MessagingResponse
const config = require('../config');

// Re-enable this if you want validation, but ensure it's correct
const twilioWebhookMiddleware = twilio.webhook({
    authToken: config.twilio.authToken,
    url: config.env === 'development' ? undefined : `https://whatsapp-transport-booking.onrender.com/webhook`,
});

router.post('/', twilioWebhookMiddleware, async (req, res) => { // Keep validation if you fixed it, otherwise remove it temporarily
    logger.info('Received Twilio WhatsApp webhook payload (validated):', { body: req.body });

    const incoming = whatsappService.parseIncomingMessage(req.body);

    if (incoming) {
        logger.info(`Message from ${incoming.sender}: "${incoming.messageText}"`);

        // --- THE NECESSARY FIX: Synchronous TwiML Response ---
        const twiml = new twilio.twiml.MessagingResponse();
        const replyMessage = `You said: "${incoming.messageText}". (Echo from Twilio TwiML bot)`;

        twiml.message(replyMessage);

        res.writeHead(200, { 'Content-Type': 'text/xml' }); // Set content type for TwiML
        res.end(twiml.toString()); // Send the TwiML response
        logger.info(`Replied synchronously to ${incoming.sender} with TwiML.`);

        // Any further complex, long-running logic can be done *after* res.end()
        // but not awaited, so that the webhook response is sent quickly.
        // For a simple echo, you don't even need the whatsappService.sendTextMessage call anymore.

    } else {
        logger.warn('Received webhook with unparseable message from Twilio (after validation).', { body: req.body });
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message("Sorry, I didn't understand that. Please try again.");
        res.writeHead(400, { 'Content-Type': 'text/xml' });
        res.end(twiml.toString());
    }
});

module.exports = router;
