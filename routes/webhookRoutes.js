// routes/webhookRoutes.js
const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const whatsappService = require('../services/whatsappService'); // New service
const twilio = require('twilio'); // Needed for MessagingResponse

// IMPORTANT: Twilio sends application/x-www-form-urlencoded
// Ensure bodyParser is configured for this, which it usually is by default
// if using `app.use(bodyParser.urlencoded({ extended: true }));`

router.post('/', async (req, res) => {
    // Log the entire incoming payload from Twilio for debugging
    logger.info('Received Twilio WhatsApp webhook payload:', { body: req.body });

    const incoming = whatsappService.parseIncomingMessage(req.body);

    if (incoming) {
        logger.info(`Message from ${incoming.sender}: "${incoming.messageText}"`);

        // --- MVP: Echo back or simple welcome ---
        // For simple echo, you can use TwiML directly.
        // For a complex bot, it's better to process asynchronously and send replies
        // using whatsappService.sendTextMessage.

        // Example of an asynchronous reply (recommended for complex bots)
        // Send a 200 OK response to Twilio immediately.
        res.status(200).send(''); // Important: Twilio expects a 200 OK or TwiML

        // Process message in the background
        try {
            // In a real bot, this would be where your main bot logic goes
            // e.g., sessionService.handleUserMessage(incoming.sender, incoming.messageText);
            const replyMessage = `You said: "${incoming.messageText}". (Echo from Twilio bot)`;
            await whatsappService.sendTextMessage(`whatsapp:${incoming.sender}`, replyMessage);
            logger.info(`Replied asynchronously to ${incoming.sender}.`);
        } catch (error) {
            logger.error(`Error processing or replying to message from ${incoming.sender}: ${error.message}`, { error: error, incomingMessage: incoming });
        }

        // --- Alternative: Synchronous TwiML Response (for simple replies) ---
        // If you want to reply synchronously (i.e., Twilio expects your app to return the message body),
        // you would use Twilio's TwiML MessagingResponse.
        /*
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message(`You said: "${incoming.messageText}". (Echo from Twilio TwiML)`);
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(twiml.toString());
        logger.info(`Replied synchronously to ${incoming.sender}.`);
        */
    } else {
        logger.warn('Received webhook with unparseable message from Twilio.', { body: req.body });
        res.status(400).send('Bad Request: Unable to parse message');
    }
});

module.exports = router;
