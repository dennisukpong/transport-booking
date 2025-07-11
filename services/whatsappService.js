// services/whatsappService.js
const twilio = require('twilio');
const config = require('../config');
const logger = require('../utils/logger'); // Import the logger

// Initialize Twilio client
const client = new twilio(config.twilio.accountSid, config.twilio.authToken);
const TWILIO_WHATSAPP_NUMBER = config.twilio.whatsappNumber; // Your Twilio WhatsApp number

const whatsappService = {
    /**
     * Sends a simple text message via Twilio WhatsApp.
     * @param {string} to - The recipient's WhatsApp number (e.g., 'whatsapp:+23480xxxxxxxx').
     * @param {string} messageBody - The text content of the message.
     */
    sendTextMessage: async (to, messageBody) => {
        try {
            const message = await client.messages.create({
                to: to,
                from: TWILIO_WHATSAPP_NUMBER,
                body: messageBody,
            });
            logger.info(`Text message sent to ${to}: ${messageBody}`, { sid: message.sid });
            return message;
        } catch (error) {
            logger.error(`Error sending text message to ${to}: ${error.message}`, { error: error, recipient: to, messageBody: messageBody });
            throw new Error('Failed to send WhatsApp message.');
        }
    },

    /**
     * Sends a media message (e.g., PDF ticket) via Twilio WhatsApp.
     * @param {string} to - The recipient's WhatsApp number.
     * @param {string} mediaUrl - The publicly accessible URL of the media file.
     * @param {string} [messageBody] - Optional text message to accompany the media.
     */
    sendMediaMessage: async (to, mediaUrl, messageBody = '') => {
        try {
            const message = await client.messages.create({
                to: to,
                from: TWILIO_WHATSAPP_NUMBER,
                body: messageBody, // Optional body text
                mediaUrl: [mediaUrl], // Array for multiple media items, but WhatsApp usually sends one
            });
            logger.info(`Media message sent to ${to} with URL: ${mediaUrl}`, { sid: message.sid });
            return message;
        } catch (error) {
            logger.error(`Error sending media message to ${to}: ${error.message}`, { error: error, recipient: to, mediaUrl: mediaUrl });
            throw new Error('Failed to send WhatsApp media message.');
        }
    },

    /**
     * Handles incoming WhatsApp messages from Twilio webhook payload.
     * Extracts sender and message body.
     * @param {object} payload - The raw request body from Twilio webhook.
     * @returns {object|null} - An object with { sender, messageText } or null if invalid.
     */
    parseIncomingMessage: (payload) => {
        // Twilio sends form-urlencoded data for incoming messages, often in req.body
        // The sender's WhatsApp ID is in 'From' field (e.g., 'whatsapp:+23480xxxxxxxx')
        // The message body is in 'Body' field.
        const sender = payload.From;
        const messageText = payload.Body;
        const mediaUrl = payload.MediaUrl0; // If media is sent
        const numMedia = parseInt(payload.NumMedia || '0');

        if (sender && messageText !== undefined) { // Check for undefined to allow empty messages
            const waId = sender.replace('whatsapp:', ''); // Get just the number
            return {
                sender: waId,
                messageText: messageText,
                isMedia: numMedia > 0,
                mediaUrl: mediaUrl
            };
        }
        logger.warn('Received invalid Twilio webhook payload.', { payload: payload });
        return null;
    }
};

module.exports = whatsappService;
