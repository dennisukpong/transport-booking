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
                // Using findOneAndUpdate to ensure the reset is atomic and returns the new state
                session = await Session.findOneAndUpdate( // <<< IMPORTANT: Reassign session here
                    { waId },
                    {
                        $set: {
                            currentStep: 'welcome',
                            bookingDetails: {},
                            context: {},
                            lastActive: Date.now()
                        }
                    },
                    { new: true, upsert: true } // Returns the updated document, creates if not found
                );
                logger.info(`Session timed out for ${waId}. Resetting.`);
                return session; // Return the newly reset session immediately
            }
        }
        await session.save(); // Update lastActive timestamp on existing or newly created sessions
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
            { new: true, upsert: true } // IMPORTANT: returns the updated document
        );
        logger.debug(`Session for ${waId} updated to step: ${newStep}.`);
        return session;
    },

    /**
     * Updates specific booking details in the session.
     * @param {string} waId - The WhatsApp ID of the user.
     * @param {object} updates - An object with fields to update in bookingDetails.
     * @returns {Promise<object>} The updated session object.
     */
    updateBookingDetails: async (waId, updates) => {
        // Use $set to update specific fields within the nested bookingDetails object
        const session = await Session.findOneAndUpdate(
            { waId },
            { $set: { "bookingDetails.origin": updates.origin, // Example for specific fields
                      "bookingDetails.destination": updates.destination,
                      "bookingDetails.date": updates.date,
                      "bookingDetails.passengers": updates.passengers,
                      "bookingDetails.departureId": updates.departureId,
                      "bookingDetails.fare": updates.fare,
                      "bookingDetails.totalAmount": updates.totalAmount,
                      lastActive: Date.now()
                    }
            },
            { new: true, upsert: true } // IMPORTANT: returns the updated document
        );
        if (!session) {
            logger.error(`Session not found for ${waId} when trying to update booking details.`);
        } else {
            logger.debug(`Booking details for ${waId} updated. Current bookingDetails: ${JSON.stringify(session.bookingDetails)}.`);
        }
        return session;
    },

    /**
     * Updates context details in the session.
     * @param {string} waId - The WhatsApp ID of the user.
     * @param {object} updates - An object with fields to update in context.
     * @returns {Promise<object>} The updated session object.
     */
    updateSessionContext: async (waId, updates) => {
        // To update context fields dynamically, use dot notation or Object.keys
        const updateDoc = { lastActive: Date.now() };
        for (const key in updates) {
            updateDoc[`context.${key}`] = updates[key];
        }

        const session = await Session.findOneAndUpdate(
            { waId },
            { $set: updateDoc }, // $set is crucial for updating nested objects correctly
            { new: true, upsert: true } // IMPORTANT: returns the updated document
        );
        if (!session) {
            logger.error(`Session not found for ${waId} when trying to update session context.`);
        } else {
            logger.debug(`Session context for ${waId} updated. Current context: ${JSON.stringify(session.context)}.`);
        }
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
            { new: true, upsert: true } // IMPORTANT: returns the updated document
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
