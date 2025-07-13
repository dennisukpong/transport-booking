// services/sessionService.js
const Session = require('../models/Session');
const User = require('../models/User'); // Will be useful for language preferences, etc.
const logger = require('../utils/logger');

const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours in milliseconds

const sessionService = {

    /**
     * Finds or creates a user session.
     * If session is too old/inactive, it resets it.
     * @param {string} waId - The WhatsApp ID of the user.
     * @returns {Promise<object>} The user's session object.
     */
    getSession: async (waId) => {
        let session = await Session.findOne({ waId });

        if (!session) {
            // Create new session if none exists
            session = new Session({ waId });
            logger.info(`New session created for ${waId}.`);
        } else {
            // Check for session timeout
            const lastActiveTime = session.lastActive.getTime();
            const currentTime = Date.now();

            if (currentTime - lastActiveTime > SESSION_TIMEOUT_MS) {
                // Session timed out, reset it
                session.currentStep = 'welcome';
                session.bookingDetails = {};
                session.context = {};
                logger.info(`Session timed out for ${waId}. Resetting.`);
            }
        }
        await session.save(); // Update lastActive timestamp
        return session;
    },

    /**
     * Updates the current step of a user's session.
     * @param {string} waId - The WhatsApp ID of the user.
     * @param {string} newStep - The new conversational step.
     * @returns {Promise<object>} The updated session object.
     */
    updateSessionStep: async (waId, newStep) => {
        const session = await Session.findOneAndUpdate(
            { waId },
            { $set: { currentStep: newStep, lastActive: Date.now() } },
            { new: true, upsert: true }
        );
        logger.debug(`Session for ${waId} updated to step: ${newStep}.`);
        return session;
    },
// Corrected helper functions within sessionService:

    /**
     * Updates specific booking details in the session.
     * @param {string} waId - The WhatsApp ID of the user.
     * @param {object} updates - An object with fields to update in bookingDetails.
     * @returns {Promise<object>} The updated session object.
     */
    updateBookingDetails: async (waId, updates) => {
        const session = await Session.findOne({ waId });
        if (!session) {
            logger.error(`Session not found for ${waId} when trying to update booking details.`);
            return null; // Or throw an error
        }
        Object.assign(session.bookingDetails, updates);
        session.lastActive = Date.now();
        await session.save();
        logger.debug(`Booking details for ${waId} updated: ${JSON.stringify(updates)}.`);
        return session;
    },

    /**
     * Updates context details in the session.
     * @param {string} waId - The WhatsApp ID of the user.
     * @param {object} updates - An object with fields to update in context.
     * @returns {Promise<object>} The updated session object.
     */
    updateSessionContext: async (waId, updates) => {
        const session = await Session.findOne({ waId });
        if (!session) {
            logger.error(`Session not found for ${waId} when trying to update session context.`);
            return null; // Or throw an error
        }
        Object.assign(session.context, updates);
        session.lastActive = Date.now();
        await session.save();
        logger.debug(`Session context for ${waId} updated: ${JSON.stringify(updates)}.`);
        return session;
    },

 

    /**
     * Resets a user's session to the welcome state.
     * @param {string} waId - The WhatsApp ID of the user.
     * @returns {Promise<object>} The reset session object.
     */
    resetSession: async (waId) => {
        const session = await Session.findOneAndUpdate(
            { waId },
            { $set: { currentStep: 'welcome', bookingDetails: {}, context: {}, lastActive: Date.now() } },
            { new: true, upsert: true }
        );
        logger.info(`Session for ${waId} reset.`);
        return session;
    },

    // A placeholder for a user model interaction (if you want to store user preferences long-term)
    getOrCreateUser: async (waId) => {
        let user = await User.findOne({ waId });
        if (!user) {
            user = new User({ waId });
            await user.save();
            logger.info(`New user created: ${waId}`);
        }
        return user;
    }
};

module.exports = sessionService;
