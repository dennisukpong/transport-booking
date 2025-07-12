// routes/webhookRoutes.js
const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const whatsappService = require('../services/whatsappService');
const twilio = require('twilio'); // Needed for MessagingResponse
const config = require('../config');

// Twilio webhook validation middleware (keep this, but ensure it's correct if enabled)
const twilioWebhookMiddleware = twilio.webhook({
    authToken: config.twilio.authToken,
    url: config.env === 'development' ? undefined : `https://whatsapp-transport-booking.onrender.com/webhook`, // Or your actual public domain
});

router.post('/', twilioWebhookMiddleware, async (req, res) => { // Keep validation middleware if you want
    logger.info('Received Twilio WhatsApp webhook payload (validated):', { body: req.body });

    const incoming = whatsappService.parseIncomingMessage(req.body);

    if (incoming) {
        logger.info(`Message from ${incoming.sender}: "${incoming.messageText}"`);

        // --- THE FIX IS HERE: Synchronous TwiML Response ---
        const twiml = new twilio.twiml.MessagingResponse();
        const replyMessage = `You said: "${incoming.messageText}". (Echo from Twilio TwiML bot)`;

        twiml.message(replyMessage);

        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(twiml.toString());
        logger.info(`Replied synchronously to ${incoming.sender} with TwiML.`);

        // --- Optional: Asynchronous processing for complex tasks ---
        // For simple echoes, you don't need the async call anymore.
        // For complex bot logic (DB lookups, NLP, payments), you'd trigger it *after* sending TwiML
        // but not await it if it's long-running. You'd then use whatsappService.sendTextMessage
        // for subsequent messages or for messages that don't need to be immediate webhook replies.
        // Example:
        /*
        (async () => {
            try {
                // Simulate a delay for complex processing
                await new Promise(resolve => setTimeout(resolve, 1000));
                // Perform NLP, DB lookups, etc.
                logger.info("Asynchronous task completed for this message.");
                // If you need to send another message *later* in the conversation:
                // await whatsappService.sendTextMessage(`whatsapp:${incoming.sender}`, "This is a follow-up message after processing.");
            } catch (error) {
                logger.error(`Error during asynchronous processing for ${incoming.sender}: ${error.message}`, { error: error });
            }
        })();
        */

    } else {
        logger.warn('Received webhook with unparseable message from Twilio (after validation).', { body: req.body });
        // Even for unparseable messages, Twilio expects a 200 OK or TwiML.
        // So, respond with an empty TwiML or a simple error message.
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message("Sorry, I didn't understand that. Please try again.");
        res.writeHead(400, { 'Content-Type': 'text/xml' }); // Or 200 OK if you just want to acknowledge
        res.end(twiml.toString());
    }
});

module.exports = router;
