// services/conversationService.js
const sessionService = require('./sessionService');
const whatsappService = require('./whatsappService');
const logger = require('../utils/logger');

// Helper for sending messages based on step
const sendReply = async (waId, message, twiml) => {
    if (twiml) {
        twiml.message(message);
    } else {
        await whatsappService.sendTextMessage(`whatsapp:${waId}`, message);
    }
};

const conversationService = {
    /**
     * Handles an incoming WhatsApp message, processes it based on session state,
     * and generates the appropriate reply.
     * @param {string} waId - The WhatsApp ID of the sender.
     * @param {string} messageText - The text content of the message.
     * @param {object} twiml - The Twilio MessagingResponse object for synchronous reply.
     */
    handleIncomingMessage: async (waId, messageText, twiml) => {
        let session = await sessionService.getSession(waId);
        let reply = '';
        messageText = messageText.trim().toLowerCase(); // Normalize input

        // Handle common commands regardless of state
        if (messageText === 'hi' || messageText === 'hello' || messageText === 'start' || messageText === 'menu') {
            session = await sessionService.resetSession(waId);
            reply = "Welcome to the Transport Booking Service! 👋\n\nHow can I help you today?\n\n*1.* 🚌 Book a new trip\n*2.* ℹ️ Check my booking\n*3.* 📞 Contact support";
            await sessionService.updateSessionStep(waId, 'welcome');
        } else if (messageText === 'reset' || messageText === 'cancel') {
            session = await sessionService.resetSession(waId);
            reply = "Okay, I've reset our conversation. How can I help you today?\n\n*1.* 🚌 Book a new trip";
            await sessionService.updateSessionStep(waId, 'welcome');
        } else {
            // Process message based on current session step
            switch (session.currentStep) {
                case 'welcome':
                    if (messageText === '1' || messageText.includes('book')) {
                        reply = "Great! Let's book your trip. What is your **departure city**?";
                        await sessionService.updateSessionStep(waId, 'ask_origin');
                    } else if (messageText === '2' || messageText.includes('check')) {
                        reply = "Sure, to check your booking, please provide your booking reference number (future step).";
                        // Update to a 'check_booking' step if you implement it
                        // For now, loop back to welcome or main menu
                        await sessionService.updateSessionStep(waId, 'welcome');
                    } else if (messageText === '3' || messageText.includes('contact')) {
                        reply = "You can contact our support team at +2348012345678 or email support@transport.com.";
                        await sessionService.updateSessionStep(waId, 'main_menu'); // Go to main menu state
                    } else {
                        reply = "Please choose an option by typing the number or a keyword (e.g., '1' or 'book').";
                    }
                    break;

                case 'ask_origin':
                    if (messageText.length > 2) { // Simple validation
                        await sessionService.updateBookingDetails(waId, { origin: messageText });
                        reply = `Got it. From ${messageText}. What is your **destination city**?`;
                        await sessionService.updateSessionStep(waId, 'ask_destination');
                    } else {
                        reply = "Please provide a valid departure city name (at least 3 characters).";
                    }
                    break;

                case 'ask_destination':
                    if (messageText.length > 2) { // Simple validation
                        await sessionService.updateBookingDetails(waId, { destination: messageText });
                        reply = `Okay, to ${messageText}. When would you like to travel? Please provide the **date** (e.g., *YYYY-MM-DD* or *tomorrow* or *next Monday*).`;
                        await sessionService.updateSessionStep(waId, 'ask_date');
                    } else {
                        reply = "Please provide a valid destination city name (at least 3 characters).";
                    }
                    break;

                case 'ask_date':
                    const parsedDate = conversationService.parseDateInput(messageText);
                    if (parsedDate && parsedDate >= new Date(new Date().setHours(0,0,0,0))) { // Date must be today or in future
                        await sessionService.updateBookingDetails(waId, { date: parsedDate });
                        reply = `Traveling on ${parsedDate.toDateString()}. How many **passengers** will there be? (Enter a number)`;
                        await sessionService.updateSessionStep(waId, 'ask_passengers');
                    } else {
                        reply = "I couldn't understand that date. Please provide the date in format YYYY-MM-DD (e.g., 2025-07-20), 'tomorrow', or 'next [day of week]'.";
                    }
                    break;

                case 'ask_passengers':
                    const numPassengers = parseInt(messageText, 10);
                    if (!isNaN(numPassengers) && numPassengers > 0 && numPassengers <= 10) { // Max 10 passengers for simplicity
                        await sessionService.updateBookingDetails(waId, { passengers: numPassengers });
                        // Now, review the booking
                        session = await sessionService.getSession(waId); // Fetch updated session for review
                        const { origin, destination, date, passengers } = session.bookingDetails;
                        let reviewMsg = `Alright, let's review your trip:\n`;
                        reviewMsg += `*From:* ${origin || 'N/A'}\n`;
                        reviewMsg += `*To:* ${destination || 'N/A'}\n`;
                        reviewMsg += `*Date:* ${date ? date.toDateString() : 'N/A'}\n`;
                        reviewMsg += `*Passengers:* ${passengers || 'N/A'}\n\n`;
                        reviewMsg += `Is this correct? Reply 'Yes' to confirm or 'No' to start over.`;
                        reply = reviewMsg;
                        await sessionService.updateSessionStep(waId, 'review_booking');
                    } else {
                        reply = "Please enter a valid number of passengers (1-10).";
                    }
                    break;

                case 'review_booking':
                    if (messageText === 'yes') {
                        reply = "Great! Your booking is being processed. (This is where payment/final confirmation will go - future step)\n\n" +
                                "Thank you for booking with us! You will receive a confirmation shortly.";
                        // In future: Trigger booking finalization service, payment
                        await sessionService.updateSessionStep(waId, 'booking_complete');
                    } else if (messageText === 'no') {
                        session = await sessionService.resetSession(waId);
                        reply = "No problem, let's start over. What is your **departure city**?";
                        await sessionService.updateSessionStep(waId, 'ask_origin');
                    } else {
                        reply = "Please reply 'Yes' to confirm or 'No' to start over.";
                    }
                    break;

                case 'booking_complete':
                    reply = "Your booking is complete! I'm ready for a new task. Say 'menu' to see options.";
                    await sessionService.updateSessionStep(waId, 'main_menu');
                    break;

                case 'main_menu':
                    reply = "How can I help you today?\n\n*1.* 🚌 Book a new trip\n*2.* ℹ️ Check my booking\n*3.* 📞 Contact support";
                    await sessionService.updateSessionStep(waId, 'welcome'); // Loop back to welcome for option handling
                    break;

                default:
                    reply = "I'm sorry, I don't understand that. Please type 'menu' to see options.";
                    await sessionService.updateSessionStep(waId, 'welcome');
                    break;
            }
        }

        await sendReply(waId, reply, twiml);
    },

    /**
     * Helper function to parse various date inputs.
     * Could be expanded with a more robust date parsing library if needed.
     * @param {string} input
     * @returns {Date|null}
     */
    parseDateInput: (input) => {
        let date = null;
        const today = new Date();
        today.setHours(0,0,0,0); // Normalize to start of day for comparison

        if (input === 'today') {
            date = today;
        } else if (input === 'tomorrow') {
            date = new Date(today);
            date.setDate(today.getDate() + 1);
        } else if (input.startsWith('next ')) {
            const dayOfWeekStr = input.substring(5).toLowerCase();
            const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
            const dayIndex = days.indexOf(dayOfWeekStr);
            if (dayIndex !== -1) {
                date = new Date(today);
                date.setDate(today.getDate() + (dayIndex + 7 - today.getDay()) % 7);
                if (date <= today) { // If next [day] is today or in the past, get next week's
                    date.setDate(date.getDate() + 7);
                }
            }
        } else {
            // Try parsing as YYYY-MM-DD
            const parts = input.split('-');
            if (parts.length === 3) {
                const year = parseInt(parts[0], 10);
                const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
                const day = parseInt(parts[2], 10);
                if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
                    date = new Date(year, month, day);
                    if (date.getMonth() !== month || date.getDate() !== day) {
                        // Invalid date (e.g., Feb 30)
                        date = null;
                    }
                }
            }
        }

        // Ensure date is not in the past
        if (date && date < today) {
            return null;
        }

        return date;
    }
};

module.exports = conversationService;
