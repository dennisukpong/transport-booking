// services/conversationService.js
const sessionService = require('./sessionService');
const whatsappService = require('./whatsappService');
const logger = require('../utils/logger');
const Route = require('../models/Route');
const Departure = require('../models/Departure');
const Booking = require('../models/Booking');

// Helper for sending messages based on step
const sendReply = async (waId, message, twiml) => {
    if (twiml) {
        twiml.message(message);
    } else {
        // This path is for asynchronous replies, not used for immediate webhook responses
        // Will be useful for notifications or out-of-band messages later
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

        logger.debug(`[Conversation] WA ID: ${waId}, Raw Message: "${messageText}", Current Step: ${session.currentStep}`);

        // Handle common commands regardless of state
        if (messageText === 'hi' || messageText === 'hello' || messageText === 'start' || messageText === 'menu') {
            logger.debug(`[Conversation] Matched global 'menu' command.`);
            session = await sessionService.resetSession(waId);
            reply = "Welcome to the Transport Booking Service! 👋\n\nHow can I help you today?\n\n*1.* 🚌 Book a new trip\n*2.* ℹ️ Check my booking\n*3.* 📞 Contact support";
            await sessionService.updateSessionStep(waId, 'welcome');
        } else if (messageText === 'reset' || messageText === 'cancel') {
            logger.debug(`[Conversation] Matched global 'reset' command.`);
            session = await sessionService.resetSession(waId);
            reply = "Okay, I've reset our conversation. How can I help you today?\n\n*1.* 🚌 Book a new trip";
            await sessionService.updateSessionStep(waId, 'welcome');
        } else {
            // Process message based on current session step
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
                            await sessionService.updateSessionStep(waId, 'welcome');
                            logger.debug(`[Conversation - welcome] No origins found.`);
                        }
                    } else if (messageText === '2' || messageText.includes('check')) {
                        reply = "Sure, to check your booking, please provide your booking reference number (future step).";
                        await sessionService.updateSessionStep(waId, 'welcome');
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
                    // Fetch the latest session to ensure we have the most current context
                    session = await sessionService.getSession(waId);
                    const availableOrigins = session.context.availableOrigins || [];
                    logger.debug(`[Conversation - ask_origin] Available Origins in session context: ${JSON.stringify(availableOrigins)}`);
                    logger.debug(`[Conversation - ask_origin] Calling validateChoice with input: "${messageText}" and options: ${JSON.stringify(availableOrigins)}`);

                    const chosenOrigin = conversationService.validateChoice(messageText, availableOrigins);
                    logger.debug(`[Conversation - ask_origin] validateChoice returned: "${chosenOrigin}"`);

                    if (chosenOrigin) {
                        logger.debug(`[Conversation - ask_origin] Chosen origin "${chosenOrigin}" IS valid.`);
                        await sessionService.updateBookingDetails(waId, { origin: chosenOrigin.toUpperCase() });
                        const destinations = await Route.distinct('destination', { origin: chosenOrigin.toUpperCase(), isActive: true });
                        if (destinations && destinations.length > 0) {
                            reply = `Okay, from ${chosenOrigin}. Where would you like to **go to**?\n\n` +
                                    destinations.map((d, i) => `*${i + 1}.* ${d}`).join('\n') +
                                    "\n\nPlease reply with the city name or number.";
                            await sessionService.updateSessionContext(waId, { availableDestinations: destinations });
                            await sessionService.updateSessionStep(waId, 'ask_destination');
                            logger.debug(`[Conversation - ask_origin] Destinations fetched and stored in context: ${JSON.stringify(destinations)}`);
                        } else {
                            reply = `Sorry, no destinations available from ${chosenOrigin}. Please choose a different origin or type 'reset'.`;
                            await sessionService.resetSession(waId); // Restart if no destinations
                            logger.warn(`[Conversation - ask_origin] No destinations found for origin ${chosenOrigin}. Resetting session.`);
                        }
                    } else {
                        logger.debug(`[Conversation - ask_origin] Chosen origin "${messageText}" IS NOT valid. Re-prompting.`);
                        reply = "I didn't recognize that departure city. Please choose from the list or type 'menu' to start over.";
                        // Re-list origins if invalid input
                        const origins = await Route.distinct('origin', { isActive: true }); // Re-fetch in case context was somehow lost or cleared
                        if (origins && origins.length > 0) {
                            reply += "\n\nAvailable origins:\n" + origins.map((o, i) => `*${i + 1}.* ${o}`).join('\n');
                        }
                    }
                    break;

                case 'ask_destination':
                    logger.debug(`[Conversation - ask_destination] Processing message: "${messageText}"`);
                    session = await sessionService.getSession(waId); // Refresh session for latest context
                    const availableDestinations = session.context.availableDestinations || [];
                    logger.debug(`[Conversation - ask_destination] Available Destinations in session context: ${JSON.stringify(availableDestinations)}`);

                    const chosenDestination = conversationService.validateChoice(messageText, availableDestinations);
                    logger.debug(`[Conversation - ask_destination] validateChoice returned: "${chosenDestination}"`);

                    if (chosenDestination) {
                        logger.debug(`[Conversation - ask_destination] Chosen destination "${chosenDestination}" IS valid.`);
                        await sessionService.updateBookingDetails(waId, { destination: chosenDestination.toUpperCase() });
                        reply = `Got it, to ${chosenDestination}. When would you like to travel? Please provide the **date** (e.g., *YYYY-MM-DD*, *tomorrow*, or *next Monday*).`;
                        await sessionService.updateSessionStep(waId, 'ask_date');
                    } else {
                        logger.debug(`[Conversation - ask_destination] Chosen destination "${messageText}" IS NOT valid. Re-prompting.`);
                        reply = "I didn't recognize that destination city. Please choose from the list or type 'menu' to start over.";
                        const currentOrigin = session.bookingDetails.origin;
                        if (currentOrigin) {
                            const destinations = await Route.distinct('destination', { origin: currentOrigin, isActive: true });
                            if (destinations && destinations.length > 0) {
                                reply += `\n\nAvailable destinations from ${currentOrigin}:\n` + destinations.map((d, i) => `*${i + 1}.* ${d}`).join('\n');
                            }
                        }
                    }
                    break;

                case 'ask_date':
                    logger.debug(`[Conversation - ask_date] Processing message: "${messageText}"`);
                    const parsedDate = conversationService.parseDateInput(messageText);
                    logger.debug(`[Conversation - ask_date] Parsed date: ${parsedDate ? parsedDate.toISOString() : 'null'}`);

                    if (parsedDate && parsedDate >= new Date(new Date().setHours(0,0,0,0))) {
                        await sessionService.updateBookingDetails(waId, { date: parsedDate });
                        session = await sessionService.getSession(waId); // Fetch updated session for latest bookingDetails
                        const { origin, destination } = session.bookingDetails;
                        logger.debug(`[Conversation - ask_date] Attempting to find route for Origin: ${origin}, Destination: ${destination}`);
                        const route = await Route.findOne({ origin: origin, destination: destination, isActive: true });

                        if (route) {
                            logger.debug(`[Conversation - ask_date] Route found: ${route._id}. Searching for departures.`);
                            const departures = await Departure.find({
                                route: route._id,
                                departureTime: {
                                    $gte: new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate(), 0, 0, 0),
                                    $lt: new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate(), 23, 59, 59)
                                },
                                availableSeats: { $gt: 0 },
                                status: 'scheduled'
                            }).populate('vehicle').sort('departureTime');
                            logger.debug(`[Conversation - ask_date] Found ${departures.length} departures.`);

                            if (departures && departures.length > 0) {
                                let departureOptions = `Great! Here are the available departures for ${origin} to ${destination} on ${parsedDate.toDateString()}:\n\n`;
                                departures.forEach((dep, i) => {
                                    const departureTime = new Date(dep.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                    departureOptions += `*${i + 1}.* ${dep.vehicle.name} at ${departureTime} - Fare: NGN${dep.fare.toLocaleString()} - Seats: ${dep.availableSeats}\n`;
                                });
                                departureOptions += "\nPlease reply with the number of your preferred departure.";
                                await sessionService.updateSessionContext(waId, { availableDepartures: departures.map(d => d._id.toString()) }); // Store IDs for validation
                                await sessionService.updateSessionStep(waId, 'ask_departure_choice');
                                reply = departureOptions;
                                logger.debug(`[Conversation - ask_date] Departures found, moving to ask_departure_choice.`);
                            } else {
                                reply = `Sorry, no available departures found for ${origin} to ${destination} on ${parsedDate.toDateString()}. Please choose another date or type 'reset'.`;
                                await sessionService.updateSessionStep(waId, 'ask_date');
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
                    session = await sessionService.getSession(waId); // Refresh session for latest context
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
                                fare: chosenDeparture.fare
                            });
                            reply = `You've selected the ${chosenDeparture.vehicle.name} departing at ${new Date(chosenDeparture.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.\nHow many **passengers** will there be? (Enter a number)`;
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
                    const numPassengers = parseInt(messageText, 10);
                    session = await sessionService.getSession(waId); // Refresh session for latest bookingDetails
                    const currentDepartureId = session.bookingDetails.departureId;
                    const departureToBook = await Departure.findById(currentDepartureId);
                    logger.debug(`[Conversation - ask_passengers] Parsed passengers: ${numPassengers}, Departure seats available: ${departureToBook ? departureToBook.availableSeats : 'N/A'}`);

                    if (departureToBook && !isNaN(numPassengers) && numPassengers > 0 && numPassengers <= departureToBook.availableSeats) {
                        logger.debug(`[Conversation - ask_passengers] Valid number of passengers.`);
                        await sessionService.updateBookingDetails(waId, { passengers: numPassengers });
                        const updatedSession = await sessionService.getSession(waId); // Fetch updated session for review
                        const { origin, destination, passengers, departureId } = updatedSession.bookingDetails;
                        const finalDeparture = await Departure.findById(departureId).populate('route').populate('vehicle');

                        if (finalDeparture) {
                            const totalAmount = finalDeparture.fare * passengers;
                            await sessionService.updateBookingDetails(waId, { totalAmount: totalAmount });
                            logger.debug(`[Conversation - ask_passengers] Calculated total amount: ${totalAmount}. Moving to review_booking.`);

                            let reviewMsg = `Alright, let's review your trip:\n\n`;
                            reviewMsg += `*Route:* ${finalDeparture.route.origin} to ${finalDeparture.route.destination}\n`;
                            reviewMsg += `*Departure:* ${new Date(finalDeparture.departureTime).toLocaleString([], { dateStyle: 'full', timeStyle: 'short' })} (${finalDeparture.vehicle.name})\n`;
                            reviewMsg += `*Passengers:* ${passengers}\n`;
                            reviewMsg += `*Total Fare:* NGN${totalAmount.toLocaleString()}\n\n`;
                            reviewMsg += `Is this correct? Reply 'Yes' to confirm or 'No' to start over.`;
                            reply = reviewMsg;
                            await sessionService.updateSessionStep(waId, 'review_booking');
                        } else {
                            reply = "Could not retrieve full departure details for review. Please try again or 'reset'.";
                            await sessionService.resetSession(waId);
                            logger.error(`[Conversation - ask_passengers] Failed to retrieve final departure details for review. Resetting session.`);
                        }

                    } else if (departureToBook && (numPassengers <= 0 || numPassengers > departureToBook.availableSeats)) {
                        reply = `Sorry, only ${departureToBook.availableSeats} seats are available for this departure. Please enter a number between 1 and ${departureToBook.availableSeats}.`;
                        logger.debug(`[Conversation - ask_passengers] Invalid passenger count (${numPassengers}) for available seats (${departureToBook.availableSeats}).`);
                    } else {
                        reply = "Please enter a valid number of passengers.";
                        logger.debug(`[Conversation - ask_passengers] Invalid passenger input: "${messageText}".`);
                    }
                    break;

                case 'review_booking':
                    logger.debug(`[Conversation - review_booking] Processing message: "${messageText}"`);
                    if (messageText === 'yes') {
                        logger.debug(`[Conversation - review_booking] User confirmed booking.`);
                        session = await sessionService.getSession(waId); // Refresh session for final details
                        const { departureId, passengers, totalAmount } = session.bookingDetails;

                        if (departureId && passengers && totalAmount) {
                            logger.debug(`[Conversation - review_booking] Creating new booking...`);
                            const newBooking = new Booking({
                                userId: waId,
                                sessionId: session._id,
                                departure: departureId,
                                passengers: passengers,
                                totalAmount: totalAmount,
                                status: 'pending',
                                paymentStatus: 'pending'
                            });
                            await newBooking.save();
                            logger.debug(`[Conversation - review_booking] Booking saved with ID: ${newBooking._id}, Ref: ${newBooking.bookingReference}`);

                            // Atomically reduce available seats
                            await Departure.findByIdAndUpdate(departureId, { $inc: { availableSeats: -passengers } });
                            logger.debug(`[Conversation - review_booking] Available seats for departure ${departureId} reduced by ${passengers}.`);

                            reply = `Excellent! Your booking for NGN${totalAmount.toLocaleString()} has been reserved (Reference: *${newBooking.bookingReference}*).\n\n` +
                                    "Payment instructions will follow (future step).\n\n" +
                                    "Thank you for booking with us!";
                            await sessionService.updateSessionStep(waId, 'booking_complete');
                        } else {
                            reply = "Missing booking details. Please try 'reset' and start over.";
                            await sessionService.resetSession(waId);
                            logger.error(`[Conversation - review_booking] Missing booking details despite 'yes' confirmation. Resetting session.`);
                        }

                    } else if (messageText === 'no') {
                        logger.debug(`[Conversation - review_booking] User cancelled booking.`);
                        session = await sessionService.resetSession(waId);
                        reply = "No problem, let's start over. What is your **departure city**?";
                        await sessionService.updateSessionStep(waId, 'ask_origin');
                    } else {
                        reply = "Please reply 'Yes' to confirm or 'No' to start over.";
                        logger.debug(`[Conversation - review_booking] Invalid input for confirmation: "${messageText}".`);
                    }
                    break;

                case 'booking_complete':
                    logger.debug(`[Conversation - booking_complete] Reprompting for new task.`);
                    reply = "Your booking is complete! I'm ready for a new task. Say 'menu' to see options.";
                    await sessionService.updateSessionStep(waId, 'main_menu');
                    break;

                case 'main_menu':
                    logger.debug(`[Conversation - main_menu] Displaying main menu.`);
                    reply = "How can I help you today?\n\n*1.* 🚌 Book a new trip\n*2.* ℹ️ Check my booking\n*3.* 📞 Contact support";
                    await sessionService.updateSessionStep(waId, 'welcome');
                    break;

                default:
                    logger.warn(`[Conversation] Unrecognized step '${session.currentStep}'. Resetting to welcome.`);
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
        logger.debug(`[parseDateInput] Parsing input: "${input}"`);
        let date = null;
        const today = new Date();
        today.setHours(0,0,0,0); // Normalize to start of day for comparison

        if (input === 'today') {
            date = today;
            logger.debug(`[parseDateInput] Parsed as 'today': ${date.toISOString()}`);
        } else if (input === 'tomorrow') {
            date = new Date(today);
            date.setDate(today.getDate() + 1);
            logger.debug(`[parseDateInput] Parsed as 'tomorrow': ${date.toISOString()}`);
        } else if (input.startsWith('next ')) {
            const dayOfWeekStr = input.substring(5).toLowerCase();
            const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
            const dayIndex = days.indexOf(dayOfWeekStr);
            if (dayIndex !== -1) {
                date = new Date(today);
                date.setDate(today.getDate() + (dayIndex + 7 - today.getDay()) % 7);
                 if (date.getDay() === today.getDay() && date <= today) { // If next [day] is today or in the past, get next week's
                    date.setDate(date.getDate() + 7);
                }
                logger.debug(`[parseDateInput] Parsed as 'next ${dayOfWeekStr}': ${date.toISOString()}`);
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
                    // Check if date is valid (e.g., Feb 30 becomes March 2, we want to reject it)
                    if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
                        date = null;
                    }
                }
            }
            if (date) logger.debug(`[parseDateInput] Parsed as YYYY-MM-DD: ${date.toISOString()}`);
        }

        // Ensure date is not in the past (only future or today)
        if (date && date < today) {
            logger.debug(`[parseDateInput] Date ${date.toISOString()} is in the past, returning null.`);
            return null;
        }

        logger.debug(`[parseDateInput] Final parsed date result: ${date ? date.toISOString() : 'null'}`);
        return date;
    },

    /**
     * Helper function to validate user input against a list of options (text or number).
     * @param {string} input - User's message text (already lowercased and trimmed).
     * @param {Array<string>} options - Array of valid string options (e.g., ['ABUJA', 'LAGOS']).
     * @returns {string|null} The matched option (original case from 'options' array) or null if no match.
     */
    validateChoice: (input, options) => {
        logger.debug(`[validateChoice] Input: "${input}", Options: ${JSON.stringify(options)}`);

        // 1. Try to match by exact text (case-insensitive)
        const matchedByText = options.find(opt => opt.toLowerCase() === input.toLowerCase());
        if (matchedByText) {
            logger.debug(`[validateChoice] Matched by text: "${matchedByText}"`);
            return matchedByText; // Return the original case from the options array
        }

        // 2. Try to match by number (1-indexed)
        const chosenIndex = parseInt(input, 10);
        if (!isNaN(chosenIndex) && chosenIndex >= 1 && chosenIndex <= options.length) {
            const matchedByNumber = options[chosenIndex - 1];
            logger.debug(`[validateChoice] Matched by number: "${matchedByNumber}" (Index: ${chosenIndex - 1})`);
            return matchedByNumber; // Return the original case from the options array
        }

        logger.debug(`[validateChoice] No match found.`);
        return null; // No valid choice found
    }
};

module.exports = conversationService;
