// services/conversationService.js
const sessionService = require('./sessionService');
const whatsappService = require('./whatsappService');
const logger = require('../utils/logger');
const Route = require('../models/Route');
const Departure = require('../models/Departure');
const Booking = require('../models/Booking'); // Ensure Booking model is imported
const mongoose = require('mongoose'); // Import mongoose to use ObjectId for sessionId

// Helper for sending messages (can use Twilio TwiML or direct WhatsApp API)
const sendReply = async (waId, message, twiml) => {
    if (twiml) {
        twiml.message(message); // If called from a Twilio webhook, use TwiML
    } else {
        await whatsappService.sendTextMessage(`whatsapp:${waId}`, message); // For proactive messages or simpler replies
    }
};

const conversationService = {
    /**
     * Helper to validate user choice (number or name) against a list of options.
     * @param {string} input The user's message text.
     * @param {string[]} options An array of valid string options (e.g., city names).
     * @returns {string|null} The chosen option (normalized) or null if invalid.
     */
    validateChoice: (input, options) => {
        const normalizedInput = input.trim().toLowerCase();

        // Try to match by number
        const chosenIndex = parseInt(normalizedInput, 10) - 1;
        if (!isNaN(chosenIndex) && chosenIndex >= 0 && chosenIndex < options.length) {
            return options[chosenIndex]; // Return the original case from options
        }

        // Try to match by name (case-insensitive)
        const matchedOption = options.find(option => option.toLowerCase() === normalizedInput);
        if (matchedOption) {
            return matchedOption; // Return the original case from options
        }

        return null;
    },

    /**
     * Helper to parse date input from user (YYYY-MM-DD, tomorrow, next Monday etc.)
     * This always returns a Date object set to midnight UTC for the given day.
     * @param {string} input The user's date message text.
     * @returns {Date|null} Parsed Date object (set to midnight UTC) or null if invalid or in the past.
     */
    parseDateInput: (input) => {
        const today = new Date();
        // Set today to midnight UTC for consistent comparison with parsed dates
        today.setUTCHours(0, 0, 0, 0);

        let parsedDate = null;
        const normalizedInput = input.trim().toLowerCase();

        logger.debug(`[parseDateInput] Parsing input: "${input}"`);

        // Handle 'today'
        if (normalizedInput === 'today') {
            parsedDate = new Date(today); // Clone today (already at UTC midnight)
            logger.debug(`[parseDateInput] Parsed as 'today': ${parsedDate.toISOString()}`);
        }
        // Handle 'tomorrow'
        else if (normalizedInput === 'tomorrow') {
            parsedDate = new Date(today);
            parsedDate.setUTCDate(today.getUTCDate() + 1); // Add one day in UTC
            logger.debug(`[parseDateInput] Parsed as 'tomorrow': ${parsedDate.toISOString()}`);
        }
        // Handle 'next [day of week]' (e.g., 'next monday')
        else if (normalizedInput.startsWith('next ')) {
            const dayOfWeekStr = normalizedInput.substring(5);
            const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
            const dayIndex = days.indexOf(dayOfWeekStr);

            if (dayIndex !== -1) {
                parsedDate = new Date(today); // Start from today's UTC midnight
                const currentDayIndex = today.getUTCDay(); // 0 for Sunday, 1 for Monday... in UTC
                let daysToAdd = dayIndex - currentDayIndex;
                if (daysToAdd <= 0) { // If it's today or a past day this week, go to next week
                    daysToAdd += 7;
                }
                parsedDate.setUTCDate(today.getUTCDate() + daysToAdd);
                logger.debug(`[parseDateInput] Parsed as 'next ${dayOfWeekStr}': ${parsedDate.toISOString()}`);
            }
        }
        // Handle YYYY-MM-DD format
        else if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedInput)) {
            const parts = normalizedInput.split('-');
            const year = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
            const day = parseInt(parts[2], 10);

            // Create date assuming UTC to avoid local timezone shifts during parsing
            parsedDate = new Date(Date.UTC(year, month, day));

            // Validate if the date parts match after creating the Date object (handles invalid dates like Feb 30)
            if (parsedDate.getUTCFullYear() !== year || parsedDate.getUTCMonth() !== month || parsedDate.getUTCDate() !== day) {
                parsedDate = null; // Invalid date
            } else {
                 logger.debug(`[parseDateInput] Parsed as YYYY-MM-DD: ${parsedDate.toISOString()}`);
            }
        }

        // Final check: ensure the parsed date is not in the past relative to today (UTC midnight)
        if (parsedDate && parsedDate.getTime() < today.getTime()) {
            logger.debug(`[parseDateInput] Parsed date ${parsedDate.toISOString()} is in the past, returning null.`);
            return null;
        }

        logger.debug(`[parseDateInput] Final parsed date result: ${parsedDate ? parsedDate.toISOString() : 'null'}`);
        return parsedDate;
    },

    /**
     * Handles an incoming WhatsApp message, processes it based on session state,
     * and generates the appropriate reply.
     * @param {string} waId - The WhatsApp ID of the sender.
     * @param {string} messageText - The text content of the message.
     * @param {object} twiml - The Twilio MessagingResponse object for synchronous reply.
     */
    handleIncomingMessage: async (waId, messageText, twiml) => {
        // Always get the freshest session at the very start of processing any message
        // This ensures we're working with the latest state from the database.
        let session = await sessionService.getSession(waId);
        let reply = '';
        messageText = messageText.trim().toLowerCase(); // Normalize user input for easier comparison

        logger.debug(`[Conversation] WA ID: ${waId}, Raw Message: "${messageText}", Current Step: ${session.currentStep}`);

        // --- Global Commands ---
        // These commands can be used at any point in the conversation to reset or get help.
        if (['hi', 'hello', 'start', 'menu'].includes(messageText)) {
            logger.debug(`[Conversation] Matched global 'menu' command. Resetting session.`);
            session = await sessionService.resetSession(waId); // This also fetches/creates a fresh session
            reply = "Welcome to the Transport Booking Service! 👋\n\nHow can I help you today?\n\n*1.* 🚌 Book a new trip\n*2.* ℹ️ Check my booking\n*3.* 📞 Contact support";
            await sessionService.updateSessionStep(waId, 'welcome');
        } else if (['reset', 'cancel'].includes(messageText)) {
            logger.debug(`[Conversation] Matched global 'reset' command. Resetting session.`);
            session = await sessionService.resetSession(waId); // This also fetches/creates a fresh session
            reply = "Okay, I've reset our conversation. How can I help you today?\n\n*1.* 🚌 Book a new trip";
            await sessionService.updateSessionStep(waId, 'welcome'); // Reset to welcome, prompt user
        } else {
            // --- Step-by-Step Conversation Flow ---
            // Process the message based on the user's current position in the booking flow.
            switch (session.currentStep) {
                case 'welcome':
                    logger.debug(`[Conversation - welcome] Processing message: "${messageText}"`);
                    if (messageText === '1' || messageText.includes('book')) {
                        logger.debug(`[Conversation - welcome] User wants to book a trip.`);
                        const origins = await Route.distinct('origin', { isActive: true });
                        if (origins && origins.length > 0) {
                            reply = "Great! Where would you like to **depart from**?\n\n" +
                                    origins.map((o, i) => `*${i + 1}.* ${o}`).join('\n') +
                                    "\n\nPlease reply with the city name or number.";
                            await sessionService.updateSessionContext(waId, { availableOrigins: origins });
                            await sessionService.updateSessionStep(waId, 'ask_origin');
                            logger.debug(`[Conversation - welcome] Origins fetched and stored in context: ${JSON.stringify(origins)}`);
                        } else {
                            reply = "Sorry, no departure locations are currently available. Please try again later.";
                            await sessionService.updateSessionStep(waId, 'welcome'); // Stay on welcome or reset for no options
                            logger.debug(`[Conversation - welcome] No origins found.`);
                        }
                    } else if (messageText === '2' || messageText.includes('check')) {
                        reply = "Sure, to check your booking, please provide your booking reference number (this feature is under development).";
                        await sessionService.updateSessionStep(waId, 'main_menu');
                        logger.debug(`[Conversation - welcome] User wants to check booking.`);
                    } else if (messageText === '3' || messageText.includes('contact')) {
                        reply = "You can contact our support team at +2348012345678 or email support@transport.com.";
                        await sessionService.updateSessionStep(waId, 'main_menu');
                        logger.debug(`[Conversation - welcome] User wants to contact support.`);
                    } else {
                        reply = "Please choose an option by typing the number or a keyword (e.g., '1' or 'book').";
                        logger.debug(`[Conversation - welcome] Invalid option, re-prompting.`);
                    }
                    break;

                case 'ask_origin':
                    logger.debug(`[Conversation - ask_origin] Processing message: "${messageText}"`);
                    session = await sessionService.getSession(waId); // Re-fetch session to ensure latest context
                    const availableOrigins = session.context.availableOrigins || [];
                    logger.debug(`[Conversation - ask_origin] Available Origins in session context: ${JSON.stringify(availableOrigins)}`);

                    const chosenOrigin = conversationService.validateChoice(messageText, availableOrigins);
                    logger.debug(`[Conversation - ask_origin] validateChoice returned: "${chosenOrigin}"`);

                    if (chosenOrigin) {
                        logger.debug(`[Conversation - ask_origin] Chosen origin "${chosenOrigin}" IS valid.`);
                        await sessionService.updateBookingDetails(waId, { origin: chosenOrigin.toUpperCase() });
                        // CRITICAL: Refresh session immediately after update to use updated bookingDetails
                        session = await sessionService.getSession(waId);

                        const destinations = await Route.distinct('destination', { origin: session.bookingDetails.origin, isActive: true });
                        if (destinations && destinations.length > 0) {
                            reply = `Okay, from ${chosenOrigin}. Where would you like to **go to**?\n\n` +
                                    destinations.map((d, i) => `*${i + 1}.* ${d}`).join('\n') +
                                    "\n\nPlease reply with the city name or number.";
                            await sessionService.updateSessionContext(waId, { availableDestinations: destinations });
                            await sessionService.updateSessionStep(waId, 'ask_destination');
                            logger.debug(`[Conversation - ask_origin] Destinations fetched and stored in context: ${JSON.stringify(destinations)}`);
                        } else {
                            reply = `Sorry, no destinations available from ${chosenOrigin}. Please choose a different origin or type 'reset'.`;
                            await sessionService.resetSession(waId); // Reset if no valid destinations
                            logger.warn(`[Conversation - ask_origin] No destinations found for origin ${chosenOrigin}. Resetting session.`);
                        }
                    } else {
                        logger.debug(`[Conversation - ask_origin] Chosen origin "${messageText}" IS NOT valid. Re-prompting.`);
                        reply = "I didn't recognize that departure city. Please choose from the list or type 'menu' to start over.";
                        const origins = await Route.distinct('origin', { isActive: true }); // Re-fetch for re-prompt
                        if (origins && origins.length > 0) {
                            reply += "\n\nAvailable origins:\n" + origins.map((o, i) => `*${i + 1}.* ${o}`).join('\n');
                        }
                    }
                    break;

                case 'ask_destination':
                    logger.debug(`[Conversation - ask_destination] Processing message: "${messageText}"`);
                    session = await sessionService.getSession(waId); // Re-fetch session for latest origin
                    const availableDestinations = session.context.availableDestinations || [];
                    logger.debug(`[Conversation - ask_destination] Available Destinations in session context: ${JSON.stringify(availableDestinations)}`);

                    const chosenDestination = conversationService.validateChoice(messageText, availableDestinations);
                    logger.debug(`[Conversation - ask_destination] validateChoice returned: "${chosenDestination}"`);

                    if (chosenDestination) {
                        logger.debug(`[Conversation - ask_destination] Chosen destination "${chosenDestination}" IS valid.`);
                        await sessionService.updateBookingDetails(waId, { destination: chosenDestination.toUpperCase() });
                        // CRITICAL: Refresh session immediately after update
                        session = await sessionService.getSession(waId);
                        reply = `Got it, to ${chosenDestination}. When would you like to travel? Please provide the **date** (e.g., *YYYY-MM-DD*, *tomorrow*, or *next Monday*).`;
                        await sessionService.updateSessionStep(waId, 'ask_date');
                    } else {
                        logger.debug(`[Conversation - ask_destination] Chosen destination "${messageText}" IS NOT valid. Re-prompting.`);
                        reply = "I didn't recognize that destination city. Please choose from the list or type 'menu' to start over.";
                        const currentOrigin = session.bookingDetails.origin;
                        if (currentOrigin) {
                            const destinations = await Route.distinct('destination', { origin: currentOrigin, isActive: true }); // Re-fetch for re-prompt
                            if (destinations && destinations.length > 0) {
                                reply += `\n\nAvailable destinations from ${currentOrigin}:\n` + destinations.map((d, i) => `*${i + 1}.* ${d}`).join('\n');
                            }
                        }
                    }
                    break;

                case 'ask_date':
                    logger.debug(`[Conversation - ask_date] Processing message: "${messageText}"`);
                    session = await sessionService.getSession(waId); // Re-fetch session for latest origin/destination
                    const parsedDate = conversationService.parseDateInput(messageText);
                    logger.debug(`[Conversation - ask_date] Parsed date (from user input): ${parsedDate ? parsedDate.toISOString() : 'null'}`);

                    // Validate parsedDate is a valid Date object and not in the past
                    if (parsedDate && parsedDate instanceof Date && !isNaN(parsedDate.getTime())) {
                        await sessionService.updateBookingDetails(waId, { date: parsedDate });
                        // CRITICAL: Refresh session immediately after update
                        session = await sessionService.getSession(waId);
                        const { origin, destination } = session.bookingDetails;
                        logger.debug(`[Conversation - ask_date] Attempting to find route for Origin: ${origin}, Destination: ${destination}`);
                        const route = await Route.findOne({ origin: origin, destination: destination, isActive: true });

                        if (route) {
                            logger.debug(`[Conversation - ask_date] Route found: ${route._id}. Searching for departures.`);

                            // Create a date range for the query (start of selected day UTC to start of next day UTC)
                            const startOfSelectedDayUTC = new Date(parsedDate);
                            startOfSelectedDayUTC.setUTCHours(0, 0, 0, 0); // Already set by parseDateInput, but ensures consistency

                            const endOfSelectedDayUTC = new Date(parsedDate);
                            endOfSelectedDayUTC.setUTCDate(endOfSelectedDayUTC.getUTCDate() + 1); // Increment day by 1 in UTC
                            endOfSelectedDayUTC.setUTCHours(0, 0, 0, 0);

                            logger.debug(`[Conversation - ask_date] Query Range for Departures (UTC): $gte ${startOfSelectedDayUTC.toISOString()}, $lt ${endOfSelectedDayUTC.toISOString()}`);

                            const departures = await Departure.find({
                                route: route._id,
                                departureTime: {
                                    $gte: startOfSelectedDayUTC,
                                    $lt: endOfSelectedDayUTC
                                },
                                availableSeats: { $gt: 0 },
                                status: 'scheduled'
                            }).populate('vehicle').sort('departureTime'); // Populate vehicle details

                            logger.debug(`[Conversation - ask_date] Found ${departures.length} departures.`);

                            if (departures && departures.length > 0) {
                                let departureOptions = `Great! Here are the available departures for ${origin} to ${destination} on ${parsedDate.toDateString()}:\n\n`;
                                departures.forEach((dep, i) => {
                                    // Display time in WAT (Africa/Lagos) for user readability
                                    const departureTime = new Date(dep.departureTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
                                    departureOptions += `*${i + 1}.* ${dep.vehicle.name} at ${departureTime} - Fare: NGN${dep.fare.toLocaleString()} - Seats: ${dep.availableSeats}\n`;
                                });
                                departureOptions += "\nPlease reply with the number of your preferred departure.";
                                await sessionService.updateSessionContext(waId, { availableDepartures: departures.map(d => d._id.toString()) });
                                await sessionService.updateSessionStep(waId, 'ask_departure_choice');
                                logger.debug(`[Conversation - ask_date] Departures found, moving to ask_departure_choice.`);
                                reply = departureOptions;
                            } else {
                                reply = `Sorry, no available departures found for ${origin} to ${destination} on ${parsedDate.toDateString()}. Please choose another date or type 'reset'.`;
                                await sessionService.updateSessionStep(waId, 'ask_date'); // Keep on ask_date to allow re-entry
                                logger.debug(`[Conversation - ask_date] No departures found for chosen date.`);
                            }
                        } else {
                            reply = "Internal error: Route not found for selected origin and destination. Please type 'reset' to start over.";
                            await sessionService.resetSession(waId);
                            logger.error(`[Conversation - ask_date] Route not found after origin/destination selected. Resetting session.`);
                        }
                    } else {
                        reply = "I couldn't understand that date or it's in the past. Please provide the date in format YYYY-MM-DD (e.g., 2025-07-20), 'tomorrow', or 'next [day of week]'.";
                        logger.debug(`[Conversation - ask_date] Invalid date input: "${messageText}".`);
                    }
                    break;

                case 'ask_departure_choice':
                    logger.debug(`[Conversation - ask_departure_choice] Processing message: "${messageText}"`);
                    session = await sessionService.getSession(waId); // Re-fetch session for availableDepartures context
                    const availableDepartures = session.context.availableDepartures || [];
                    logger.debug(`[Conversation - ask_departure_choice] Available Departure IDs in session context: ${JSON.stringify(availableDepartures)}`);

                    const chosenIndex = parseInt(messageText, 10) - 1;
                    logger.debug(`[Conversation - ask_departure_choice] Parsed index: ${chosenIndex}`);

                    if (!isNaN(chosenIndex) && chosenIndex >= 0 && chosenIndex < availableDepartures.length) {
                        const chosenDepartureId = availableDepartures[chosenIndex];
                        logger.debug(`[Conversation - ask_departure_choice] Chosen Departure ID: ${chosenDepartureId}`);
                        const chosenDeparture = await Departure.findById(chosenDepartureId).populate('vehicle');

                        if (chosenDeparture) {
                            logger.debug(`[Conversation - ask_departure_choice] Chosen Departure details: ${JSON.stringify(chosenDeparture)}`);
                            await sessionService.updateBookingDetails(waId, {
                                departureId: chosenDepartureId,
                                fare: chosenDeparture.fare // Store fare in session bookingDetails
                            });
                            // CRITICAL: Refresh session immediately after update
                            session = await sessionService.getSession(waId);

                            reply = `You've selected the ${chosenDeparture.vehicle.name} departing at ${new Date(chosenDeparture.departureTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}. There are ${chosenDeparture.availableSeats} seats available.\nHow many **passengers** will there be? (Enter a number)`;
                            await sessionService.updateSessionStep(waId, 'ask_passengers');
                            logger.debug(`[Conversation - ask_departure_choice] Departure selected, moving to ask_passengers.`);
                        } else {
                            reply = "Something went wrong with selecting that departure. Please try again or type 'reset'.";
                            await sessionService.resetSession(waId);
                            logger.error(`[Conversation - ask_departure_choice] Could not find departure with ID ${chosenDepartureId}. Resetting session.`);
                        }
                    } else {
                        reply = "Invalid selection. Please reply with the number of your preferred departure from the list.";
                        logger.debug(`[Conversation - ask_departure_choice] Invalid index "${chosenIndex}" for message "${messageText}".`);
                    }
                    break;

                case 'ask_passengers':
                    logger.debug(`[Conversation - ask_passengers] Processing message: "${messageText}"`);
                    session = await sessionService.getSession(waId); // Get freshest session for initial checks

                    const numPassengersInput = parseInt(messageText, 10);

                    // Destructure essential booking details (they should be present from previous steps)
                    const { origin, destination, date, departureId, fare } = session.bookingDetails;

                    // Validate that core details are present before proceeding
                    if (!origin || !destination || !date || !departureId || !fare) {
                        reply = "Missing previous booking details. Please try 'reset' and start over.";
                        await sessionService.resetSession(waId);
                        logger.error(`[Conversation - ask_passengers] Missing essential booking details (origin, dest, date, depId, fare) at start of ask_passengers. Session: ${JSON.stringify(session.bookingDetails)}. Resetting session.`);
                        break;
                    }

                    const departureToBook = await Departure.findById(departureId);
                    logger.debug(`[Conversation - ask_passengers] Parsed passengers: ${numPassengersInput}, Departure seats available: ${departureToBook ? departureToBook.availableSeats : 'N/A'}`);

                    // Validate number of passengers
                    if (departureToBook && !isNaN(numPassengersInput) && numPassengersInput > 0 && numPassengersInput <= departureToBook.availableSeats) {
                        logger.debug(`[Conversation - ask_passengers] Valid number of passengers.`);

                        await sessionService.updateBookingDetails(waId, { passengers: numPassengersInput });
                        // CRITICAL: Re-fetch session immediately after update to get the new 'passengers' value
                        session = await sessionService.getSession(waId);

                        // Now safely access 'passengers' from the refreshed session object
                        const passengersFromSession = session.bookingDetails.passengers;

                        // Re-populate departure details for the review message
                        const finalDeparture = await Departure.findById(departureId).populate('route').populate('vehicle');

                        if (finalDeparture) {
                            const totalAmount = finalDeparture.fare * passengersFromSession;
                            await sessionService.updateBookingDetails(waId, { totalAmount: totalAmount }); // Store total amount
                            session = await sessionService.getSession(waId); // Refresh again after totalAmount update

                            let reviewMessage = `Please review your booking details:\n\n`;
                            reviewMessage += `*From:* ${session.bookingDetails.origin}\n`;
                            reviewMessage += `*To:* ${session.bookingDetails.destination}\n`;
                            reviewMessage += `*Date:* ${new Date(session.bookingDetails.date).toDateString()}\n`;
                            reviewMessage += `*Time:* ${new Date(finalDeparture.departureTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' })}\n`;
                            reviewMessage += `*Vehicle:* ${finalDeparture.vehicle.name}\n`;
                            reviewMessage += `*Passengers:* ${session.bookingDetails.passengers}\n`;
                            reviewMessage += `*Fare per person:* NGN${session.bookingDetails.fare.toLocaleString()}\n`;
                            reviewMessage += `*Total Amount:* NGN${session.bookingDetails.totalAmount.toLocaleString()}\n\n`;
                            reviewMessage += "Reply 'Yes' to confirm or 'No' to cancel.";

                            reply = reviewMessage;
                            logger.debug(`[Conversation - ask_passengers] Calculated total amount: ${totalAmount}. Moving to review_booking.`);
                            await sessionService.updateSessionStep(waId, 'review_booking');
                        } else {
                            reply = "Could not find departure details for your booking. Please type 'reset' to start over.";
                            await sessionService.resetSession(waId);
                            logger.error(`[Conversation - ask_passengers] Final departure not found after passengers selected. Resetting session.`);
                        }
                    } else {
                        // Invalid passenger input or not enough seats
                        reply = `Invalid number of passengers or not enough seats available (${departureToBook ? departureToBook.availableSeats : 0} seats left). Please enter a valid number.`;
                        logger.debug(`[Conversation - ask_passengers] Invalid passengers input: "${messageText}".`);
                    }
                    break;

                case 'review_booking':
                    logger.debug(`[Conversation - review_booking] Processing message: "${messageText}"`);
                    session = await sessionService.getSession(waId); // Get freshest session for final confirmation

                    // Destructure all expected booking details
                    const { origin: finalOrigin, destination: finalDestination, date: finalDate, // finalDate is travelDate
                            departureId: finalDepartureId, passengers: finalPassengers,
                            fare: finalFare, totalAmount: finalTotalAmount } = session.bookingDetails;

                    if (messageText === 'yes' || messageText === 'confirm') {
                        logger.debug(`[Conversation - review_booking] User confirmed booking.`);

                        // Strict validation: Ensure all critical details are present before attempting to create booking
                        if (!finalOrigin || !finalDestination || !finalDate || !finalDepartureId || !finalPassengers || !finalFare || finalTotalAmount === undefined || finalTotalAmount === null) {
                            reply = "Missing critical booking details. Please try 'reset' and start over.";
                            await sessionService.resetSession(waId);
                            logger.error(`[Conversation - review_booking] Missing critical booking details despite 'yes' confirmation. Session bookingDetails: ${JSON.stringify(session.bookingDetails)}. Resetting session.`);
                            break; // Exit the switch case
                        }

                        const finalDeparture = await Departure.findById(finalDepartureId).populate('route').populate('vehicle');

                        if (finalDeparture) {
                            // Final check for seat availability to prevent overbooking, especially in concurrent scenarios
                            if (finalDeparture.availableSeats < finalPassengers) {
                                reply = `Sorry, only ${finalDeparture.availableSeats} seats are now available for that departure. Please try again or type 'reset'.`;
                                await sessionService.resetSession(waId);
                                logger.warn(`[Conversation - review_booking] Not enough seats for booking ${finalDepartureId}. Requested: ${finalPassengers}, Available: ${finalDeparture.availableSeats}. Resetting session.`);
                                break;
                            }

                            // --- CRITICAL FIXES FOR BOOKING OBJECT CREATION ---
                            const newBooking = new Booking({
                                userId: waId, // Using waId as userId as per Booking schema
                                sessionId: session._id, // Use the actual Mongoose _id of the session document
                                departure: finalDeparture._id,
                                passengers: finalPassengers,
                                totalAmount: finalTotalAmount, // Corrected field name to match Booking schema
                                // bookingReference is handled by pre('save') hook in Booking.js
                                // status defaults to 'pending' as per Booking.js, unless we set 'confirmed' here
                                status: 'confirmed', // Explicitly setting status as confirmed on user confirmation
                                // paymentStatus defaults to 'pending' as per Booking.js
                                // createdAt defaults to Date.now as per Booking.js
                            });

                            // --- Debugging the booking object before save ---
                            logger.debug(`[Conversation - review_booking] Attempting to save new booking: ${JSON.stringify(newBooking.toObject())}`);
                            // --- END DEBUGGING ---

                            try {
                                await newBooking.save(); // Save the new booking (pre('save') hook for bookingReference will run)
                                // Decrement available seats on the departure
                                finalDeparture.availableSeats -= finalPassengers;
                                await finalDeparture.save(); // Save the updated departure

                                reply = `🎉 Booking confirmed! Your reference number is *${newBooking.bookingReference}*. Total: NGN${newBooking.totalAmount.toLocaleString()}.\n\nThank you for choosing us!`;
                                await sessionService.resetSession(waId); // Reset session after successful booking
                                logger.info(`[Conversation - review_booking] Booking ${newBooking._id} (Ref: ${newBooking.bookingReference}) created and seats updated. Final message: "${reply}"`);
                            } catch (bookingError) {
                                logger.error(`[Conversation - review_booking] Error saving booking or updating departure: ${bookingError.message}`);
                                reply = "Sorry, there was an error finalizing your booking. Please try again or type 'reset'.";
                                await sessionService.resetSession(waId);
                            }
                        } else {
                            reply = "Could not find departure details for your booking. Please type 'reset' to start over.";
                            await sessionService.resetSession(waId);
                            logger.error(`[Conversation - review_booking] Final departure not found after confirmation. Resetting session.`);
                        }
                    } else if (messageText === 'no' || messageText === 'cancel') {
                        reply = "Okay, I've cancelled the booking process. Type 'menu' to start over.";
                        await sessionService.resetSession(waId);
                        logger.debug(`[Conversation - review_booking] User cancelled booking.`);
                    } else {
                        reply = "Please reply with 'Yes' to confirm or 'No' to cancel.";
                        logger.debug(`[Conversation - review_booking] Invalid input during review, re-prompting.`);
                    }
                    break;

                default:
                    reply = "I'm not sure what you mean. Type 'menu' to see options.";
                    logger.debug(`[Conversation] Unknown currentStep: ${session.currentStep}. Re-prompting with menu.`);
                    break;
            }
        }

        // Send the generated reply back to the user
        await sendReply(waId, reply, twiml);
    }
};

module.exports = conversationService;
