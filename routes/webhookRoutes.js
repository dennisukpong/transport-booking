// routes/webhookRoutes.js
const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const whatsappService = require('../services/whatsappService'); // For parsing incoming
const conversationService = require('../services/conversationService'); // New service
const twilio = require('twilio'); // Needed for MessagingResponse
const config = require('../config');

// Twilio webhook validation middleware (re-enable and ensure working for production)
const twilioWebhookMiddleware = twilio.webhook({
    authToken: config.twilio.authToken,
    url: config.env === 'development' ? undefined : `https://whatsapp-transport-booking.onrender.com/webhook`,
});

router.post('/', twilioWebhookMiddleware, async (req, res) => { // Keep validation if you've resolved it, or comment out for now
    logger.info('Received Twilio WhatsApp webhook payload:', { body: req.body });

    const incoming = whatsappService.parseIncomingMessage(req.body);

    if (incoming) {
        logger.info(`Processing message from ${incoming.sender}: "${incoming.messageText}"`);

        // Create a TwiML response object for synchronous replies
        const twiml = new twilio.twiml.MessagingResponse();

        try {
            // Delegate the main conversational logic to the conversation service
            await conversationService.handleIncomingMessage(
                incoming.sender,
                incoming.messageText,
                twiml // Pass the TwiML object to be populated
            );

            // Send the TwiML response back to Twilio
            res.writeHead(200, { 'Content-Type': 'text/xml' });
            res.end(twiml.toString());
            logger.info(`TwiML response sent for ${incoming.sender}.`);

        } catch (error) {
            logger.error(`Error during conversation handling for ${incoming.sender}: ${error.message}`, { error: error, incomingMessage: incoming });

            // Fallback TwiML response in case of an application error
            const errorTwiml = new twilio.twiml.MessagingResponse();
            errorTwiml.message("Oops! Something went wrong on our end. Our team has been notified. Please try again later.");
            res.writeHead(500, { 'Content-Type': 'text/xml' }); // Or 200 OK, depending on desired Twilio behavior
            res.end(errorTwiml.toString());
        }

    } else {
        logger.warn('Received webhook with unparseable message from Twilio.', { body: req.body });
        // Even for unparseable messages, Twilio expects a 200 OK or TwiML.
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message("I'm sorry, I couldn't understand your message format.");
        res.writeHead(400, { 'Content-Type': 'text/xml' });
        res.end(twiml.toString());
    }
});

module.exports = router;
