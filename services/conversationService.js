// services/conversationService.js
const Booking = require('../models/Booking');
const Session = require('../models/Session');
const Departure = require('../models/Departure');
const Route = require('../models/Route');
const Vehicle = require('../models/Vehicle');
const logger = require('../utils/logger');
const sessionService = require('./sessionService');
const waService = require('./whatsappService');

const axios = require('axios'); // For making HTTP requests to Paystack
const { v4: uuidv4 } = require('uuid'); // For unique references
require('dotenv').config(); // Load environment variables

// --- AI Feature: Sentiment Analysis Imports and Initialization ---
const natural = require('natural');

// Initialize the sentiment analyzer
// We'll use the AFINN vocabulary, which assigns scores to words based on their emotional valence.
// A stemmer helps by reducing words to their root form (e.g., "running" -> "run") for analysis.
const Analyzer = natural.SentimentAnalyzer;
const stemmer = natural.PorterStemmer; // PorterStemmer is suitable for English
const analyzer = new Analyzer("English", stemmer, "afinn");
// --- End AI Feature Initialization ---

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

/**
 * Helper to validate user's choice from a list (by number or name).
 * @param {string} userInput The user's message.
 * @param {Array<string>} options The list of valid options.
 * @returns {string|null} The chosen option in its original case, or null if invalid.
 */
const validateChoice = (userInput, options) => {
    const normalizedInput = userInput.trim().toLowerCase();

    // Try to match by number
    const num = parseInt(normalizedInput, 10);
    if (!isNaN(num) && num > 0 && num <= options.length) {
        return options[num - 1]; // Return the original case from the options array
    }

    // Try to match by name
    const foundOption = options.find(option => option.toLowerCase() === normalizedInput);
    if (foundOption) {
        return foundOption; // Return the original case
    }

    return null;
};

/**
 * Helper to parse date input from user (YYYY-MM-DD, tomorrow, next Monday etc.)
 * This always returns a Date object set to midnight UTC for the given day.
 * @param {string} input The user's date message text.
 * @returns {Date|null} Parsed Date object (set to midnight UTC) or null if invalid or in the past.
 */
const parseDateInput = (input) => {
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
};


const conversationService = {
    handleIncomingMessage: async (waId, messageText) => {
        let reply = '';
        let session = await sessionService.getSession(waId); // Always get freshest session

        // --- AI Feature: Sentiment Analysis Implementation ---
        const tokens = new natural.WordTokenizer().tokenize(messageText.toLowerCase());
        const sentimentScore = analyzer.getSentiment(tokens); // Get score
        let sentiment = 'neutral';
        if (sentimentScore > 0.5) { // Thresholds can be tuned
            sentiment = 'positive';
        } else if (sentimentScore < -0.5) { // Thresholds can be tuned
            sentiment = 'negative';
        }
        logger.info(`[AI - Sentiment] User message: "${messageText}" | Sentiment Score: ${sentimentScore} | Detected Sentiment: ${sentiment}`);
        // --- End AI Feature Implementation ---


        // --- AI Enhanced Responses based on Sentiment ---
        // If user expresses strong negative sentiment, offer help/reset
        if (sentiment === 'negative' && !['reset', 'menu', 'support'].includes(messageText.toLowerCase())) {
            reply = "I sense some frustration. I apologize if something isn't working as expected. Would you like me to reset our conversation, or perhaps connect you to human support? Just type 'reset' or 'support'.";
            // For the contest, we might *force* this response, but in production, you might still try to process their command
            // If you want to return this immediately and override other logic: return reply;
        }

        // Check for explicit commands first (like reset, menu, support)
        if (messageText.toLowerCase() === 'reset') {
            await sessionService.resetSession(waId);
            return "Okay, I've reset our conversation. Type 'menu' to start over.";
        }
        if (messageText.toLowerCase() === 'menu') {
            // Your existing menu logic
            reply = "Welcome back! Here's what I can do for you:\n\n" +
                    "*1.* Book a new trip\n" +
                    "*2.* Check my booking (Coming Soon)\n" +
                    "*3.* Help & Support (Coming Soon)\n\n" +
                    "Please reply with the number of your choice, or type 'reset' to start over.";
            await sessionService.updateSessionStep(waId, 'Welcome');
            return reply; // Return early if explicit menu
        }
        if (messageText.toLowerCase() === 'support') {
            reply = "Please wait while I connect you to a human agent. (This is a placeholder for actual support integration).";
            return reply; // Return early for support
        }


        // Main conversational flow based on session step
        switch (session.currentStep) {
            case 'welcome':
                logger.debug(`[Conversation - start] Processing message: "${messageText}"`);
                if (messageText === '1' || messageText.toLowerCase() === 'book a new trip') {
                    const origins = await Route.distinct('origin', { isActive: true });
                    if (origins && origins.length > 0) {
                        let welcomeMessage = "Great! Where would you like to **depart from**?\n\n" +
                                            origins.map((o, i) => `*${i + 1}.* ${o}`).join('\n') +
                                            "\n\nPlease reply with the city name or number.";
                        // Enhance welcome message based on positive sentiment
                        if (sentiment === 'positive') {
                            welcomeMessage = "Fantastic choice! Let's get you set up for your next trip. " + welcomeMessage;
                        }
                        reply = welcomeMessage;
                        await sessionService.updateSessionContext(waId, { availableOrigins: origins });
                        await sessionService.updateSessionStep(waId, 'ask_origin');
                    } else {
                        reply = "Sorry, no routes are currently available. Please try again later or type 'reset'.";
                        await sessionService.resetSession(waId);
                    }
                } else if (messageText === '2' || messageText.toLowerCase() === 'check my booking') {
                    reply = "Checking your booking is coming soon! Stay tuned.";
                    // Keep on 'start' or move to a 'future_feature_pending' step
                } else if (messageText === '3' || messageText.toLowerCase() === 'help & support') {
                    reply = "Help & Support features are coming soon! For now, you can try 'reset'.";
                    // Keep on 'start'
                } else {
                    reply = "I didn't understand that. Please choose from the options (1, 2, 3) or type 'menu' to see options.";
                }
                break;

            case 'ask_origin':
                logger.debug(`[Conversation - ask_origin] Processing message: "${messageText}"`);
                session = await sessionService.getSession(waId); // Re-fetch session
                const availableOrigins = session.context.availableOrigins || [];

                const chosenOrigin = validateChoice(messageText, availableOrigins);

                if (chosenOrigin) {
                    await sessionService.updateBookingDetails(waId, { origin: chosenOrigin.toUpperCase() });
                    session = await sessionService.getSession(waId); // Refresh session

                    const destinations = await Route.distinct('destination', { origin: session.bookingDetails.origin, isActive: true });
                    if (destinations && destinations.length > 0) {
                        reply = `Okay, from ${chosenOrigin}. Where would you like to **go to**?\n\n` +
                                destinations.map((d, i) => `*${i + 1}.* ${d}`).join('\n') +
                                "\n\nPlease reply with the city name or number.";
                        await sessionService.updateSessionContext(waId, { availableDestinations: destinations });
                        await sessionService.updateSessionStep(waId, 'ask_destination');
                    } else {
                        reply = `Sorry, no destinations available from ${chosenOrigin}. Please choose a different origin or type 'reset'.`;
                        await sessionService.resetSession(waId);
                        logger.warn(`[Conversation - ask_origin] No destinations found for origin ${chosenOrigin}. Resetting session.`);
                    }
                } else {
                    reply = "I didn't recognize that departure city. Please choose from the list or type 'menu' to start over.";
                    const origins = await Route.distinct('origin', { isActive: true });
                    if (origins && origins.length > 0) {
                        reply += "\n\nAvailable origins:\n" + origins.map((o, i) => `*${i + 1}.* ${o}`).join('\n');
                    }
                }
                break;

            case 'ask_destination':
                logger.debug(`[Conversation - ask_destination] Processing message: "${messageText}"`);
                session = await sessionService.getSession(waId);
                const availableDestinations = session.context.availableDestinations || [];

                const chosenDestination = validateChoice(messageText, availableDestinations);

                if (chosenDestination) {
                    await sessionService.updateBookingDetails(waId, { destination: chosenDestination.toUpperCase() });
                    session = await sessionService.getSession(waId); // Refresh session
                    reply = `Got it, to ${chosenDestination}. When would you like to travel? Please provide the **date** (e.g., *YYYY-MM-DD*, *tomorrow*, or *next Monday*).`;
                    await sessionService.updateSessionStep(waId, 'ask_date');
                } else {
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
                session = await sessionService.getSession(waId); // Re-fetch session for latest origin/destination
                const parsedDate = parseDateInput(messageText);
                logger.debug(`[Conversation - ask_date] Parsed date (from user input): ${parsedDate ? parsedDate.toISOString() : 'null'}`);

                if (parsedDate && parsedDate instanceof Date && !isNaN(parsedDate.getTime())) {
                    await sessionService.updateBookingDetails(waId, { date: parsedDate });
                    session = await sessionService.getSession(waId); // Refresh session
                    const { origin, destination } = session.bookingDetails;
                    logger.debug(`[Conversation - ask_date] Attempting to find route for Origin: ${origin}, Destination: ${destination}`);
                    const route = await Route.findOne({ origin: origin, destination: destination, isActive: true });

                    if (route) {
                        logger.debug(`[Conversation - ask_date] Route found: ${route._id}. Searching for departures.`);

                        const startOfSelectedDayUTC = new Date(parsedDate);
                        startOfSelectedDayUTC.setUTCHours(0, 0, 0, 0);

                        const endOfSelectedDayUTC = new Date(parsedDate);
                        endOfSelectedDayUTC.setUTCDate(endOfSelectedDayUTC.getUTCDate() + 1);
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
                session = await sessionService.getSession(waId); // Re-fetch session
                const availableDepartureIds = session.context.availableDepartures || [];

                const chosenDepartureIndex = parseInt(messageText, 10) - 1; // Convert to 0-based index

                if (!isNaN(chosenDepartureIndex) && chosenDepartureIndex >= 0 && chosenDepartureIndex < availableDepartureIds.length) {
                    const chosenDepartureId = availableDepartureIds[chosenDepartureIndex];
                    const chosenDeparture = await Departure.findById(chosenDepartureId).populate('route');

                    if (chosenDeparture && chosenDeparture.availableSeats > 0) {
                        await sessionService.updateBookingDetails(waId, {
                            departureId: chosenDeparture._id,
                            fare: chosenDeparture.fare // Store fare at this point for calculation
                        });
                        session = await sessionService.getSession(waId); // Refresh after update
                        reply = `You've selected the ${new Date(chosenDeparture.departureTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' })} departure with ${chosenDeparture.vehicle.name}. How many passengers will be traveling? (Available seats: ${chosenDeparture.availableSeats})`;
                        await sessionService.updateSessionStep(waId, 'ask_passengers');
                    } else {
                        reply = "Sorry, that departure is no longer available or has no seats. Please choose another one or type 'reset'.";
                        // Keep on ask_departure_choice to let them choose again from remaining list
                        // Or, fetch fresh departures and re-list them here
                    }
                } else {
                    reply = "I didn't understand that choice. Please reply with the number of your preferred departure.";
                }
                break;

            case 'ask_passengers':
                logger.debug(`[Conversation - ask_passengers] Processing message: "${messageText}"`);
                session = await sessionService.getSession(waId); // Get freshest session for initial checks

                const numPassengersInput = parseInt(messageText, 10);

                const { origin, destination, date, departureId, fare } = session.bookingDetails;

                if (!origin || !destination || !date || !departureId || !fare) {
                    reply = "Missing previous booking details. Please try 'reset' and start over.";
                    await sessionService.resetSession(waId);
                    logger.error(`[Conversation - ask_passengers] Missing essential booking details (origin, dest, date, depId, fare) at start of ask_passengers. Session: ${JSON.stringify(session.bookingDetails)}. Resetting session.`);
                    break;
                }

                const departureToBook = await Departure.findById(departureId);
                logger.debug(`[Conversation - ask_passengers] Parsed passengers: ${numPassengersInput}, Departure seats available: ${departureToBook ? departureToBook.availableSeats : 'N/A'}`);

                if (departureToBook && !isNaN(numPassengersInput) && numPassengersInput > 0 && numPassengersInput <= departureToBook.availableSeats) {
                    logger.debug(`[Conversation - ask_passengers] Valid number of passengers.`);

                    await sessionService.updateBookingDetails(waId, { passengers: numPassengersInput });
                    session = await sessionService.getSession(waId);

                    const passengersFromSession = session.bookingDetails.passengers;
                    const finalDeparture = await Departure.findById(departureId).populate('route').populate('vehicle');

                    if (finalDeparture) {
                        const totalAmount = finalDeparture.fare * passengersFromSession;
                        await sessionService.updateBookingDetails(waId, { totalAmount: totalAmount });
                        session = await sessionService.getSession(waId);

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
                    reply = `Invalid number of passengers or not enough seats available (${departureToBook ? departureToBook.availableSeats : 0} seats left). Please enter a valid number.`;
                    logger.debug(`[Conversation - ask_passengers] Invalid passengers input: "${messageText}".`);
                }
                break;

            case 'review_booking':
                logger.debug(`[Conversation - review_booking] Processing message: "${messageText}"`);
                session = await sessionService.getSession(waId);

                const { origin: finalOrigin, destination: finalDestination, date: finalDate,
                        departureId: finalDepartureId, passengers: finalPassengers,
                        fare: finalFare, totalAmount: finalTotalAmount } = session.bookingDetails;

                if (messageText.toLowerCase() === 'yes' || messageText.toLowerCase() === 'confirm') {
                    logger.debug(`[Conversation - review_booking] User confirmed booking.`);

                    if (!finalOrigin || !finalDestination || !finalDate || !finalDepartureId || !finalPassengers || !finalFare || finalTotalAmount === undefined || finalTotalAmount === null) {
                        reply = "Missing critical booking details. Please try 'reset' and start over.";
                        await sessionService.resetSession(waId);
                        logger.error(`[Conversation - review_booking] Missing critical booking details despite 'yes' confirmation. Session bookingDetails: ${JSON.stringify(session.bookingDetails)}. Resetting session.`);
                        break;
                    }

                    const finalDeparture = await Departure.findById(finalDepartureId).populate('route').populate('vehicle');

                    if (finalDeparture) {
                        if (finalDeparture.availableSeats < finalPassengers) {
                            reply = `Sorry, only ${finalDeparture.availableSeats} seats are now available for that departure. Please try again or type 'reset'.`;
                            await sessionService.resetSession(waId);
                            logger.warn(`[Conversation - review_booking] Not enough seats for booking ${finalDepartureId}. Requested: ${finalPassengers}, Available: ${finalDeparture.availableSeats}. Resetting session.`);
                            break;
                        }

                        const bookingReference = `BOOK-${uuidv4().substring(0, 8).toUpperCase()}`;

                        const callbackUrl = process.env.PAYSTACK_CALLBACK_URL || `${process.env.APP_BASE_URL}/paystack-webhook`;
                        const customerEmail = session.userEmail || `${waId}@wa.com`;

                        try {
                            logger.debug(`[Paystack] Initializing payment for booking reference: ${bookingReference}, amount: ${finalTotalAmount}`);
                            const paystackResponse = await axios.post(
                                `${PAYSTACK_BASE_URL}/transaction/initialize`,
                                {
                                    email: customerEmail,
                                    amount: finalTotalAmount * 100, // Amount in kobo
                                    reference: bookingReference,
                                    currency: 'NGN',
                                    callback_url: callbackUrl,
                                    metadata: {
                                        custom_fields: [
                                            { display_name: "Customer WhatsApp ID", variable_name: "whatsapp_id", value: waId },
                                            { display_name: "Booking Session ID", variable_name: "session_id", value: session._id.toString() }
                                        ]
                                    }
                                },
                                {
                                    headers: {
                                        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                                        'Content-Type': 'application/json'
                                    }
                                }
                            );

                            if (paystackResponse.data && paystackResponse.data.status) {
                                const authorizationUrl = paystackResponse.data.data.authorization_url;
                                const transactionReference = paystackResponse.data.data.reference;

                                const newBooking = new Booking({
                                    userId: waId,
                                    sessionId: session._id,
                                    departure: finalDeparture._id,
                                    passengers: finalPassengers,
                                    totalAmount: finalTotalAmount,
                                    bookingReference: bookingReference,
                                    paymentReference: transactionReference,
                                    status: 'confirmed',
                                    paymentStatus: 'pending'
                                });

                                await newBooking.save();

                                // --- AI Enhanced Response for Confirmation ---
                                if (sentiment === 'positive') {
                                    reply = `Fantastic! 🎉 Your booking (Ref: *${bookingReference}*) has been created. Please complete your payment of NGN${finalTotalAmount.toLocaleString()} using this secure link:\n\n${authorizationUrl}\n\n*Important:* Your seats are not reserved until payment is successful.`;
                                } else {
                                    reply = `Your booking (Ref: *${bookingReference}*) has been created. Please complete your payment of NGN${finalTotalAmount.toLocaleString()} using this secure link:\n\n${authorizationUrl}\n\n*Important:* Your seats are not reserved until payment is successful.`;
                                }
                                // --- End AI Enhancement ---

                                await sessionService.updateSessionStep(waId, 'awaiting_payment');
                                await sessionService.updateSessionContext(waId, {
                                    currentBookingId: newBooking._id.toString(),
                                    paymentGatewayReference: transactionReference
                                });
                                logger.info(`[Conversation - review_booking] Booking ${newBooking._id} (Ref: ${newBooking.bookingReference}) created, payment initiated. User redirected to: ${authorizationUrl}`);
                            } else {
                                logger.error(`[Paystack] Payment initialization failed: ${JSON.stringify(paystackResponse.data)}`);
                                reply = "Sorry, I couldn't initiate payment at this time. Please try again or type 'reset'.";
                                await sessionService.resetSession(waId);
                            }

                        } catch (paymentError) {
                            logger.error(`[Paystack - Initialization Error] ${paymentError.message}. Details: ${paymentError.response ? JSON.stringify(paymentError.response.data) : 'No response data'}`);
                            reply = "Sorry, there was an error initiating payment. Please try again later or type 'reset'.";
                            await sessionService.resetSession(waId);
                        }

                    } else {
                        reply = "Could not find departure details for your booking. Please type 'reset' to start over.";
                        await sessionService.resetSession(waId);
                        logger.error(`[Conversation - review_booking] Final departure not found after confirmation. Resetting session.`);
                    }
                } else if (messageText.toLowerCase() === 'no' || messageText.toLowerCase() === 'cancel') {
                    reply = "Okay, I've cancelled the booking process. Type 'menu' to start over.";
                    await sessionService.resetSession(waId);
                    logger.debug(`[Conversation - review_booking] User cancelled booking.`);
                } else {
                    reply = "Please reply with 'Yes' to confirm or 'No' to cancel.";
                    logger.debug(`[Conversation - review_booking] Invalid input during review, re-prompting.`);
                }
                break;

            case 'awaiting_payment':
                // This step is specifically for when the bot is waiting for a webhook confirmation.
                // If the user sends a message while in this state, it means they might have questions or issues.
                // The bot shouldn't try to process it as a booking step.
                reply = "I'm currently waiting for your payment confirmation. If you've already paid, please wait a moment for me to update. If you're having trouble, please type 'support' or 'reset'.";
                logger.debug(`[Conversation - awaiting_payment] User sent message "${messageText}" while awaiting payment.`);
                break;

            default:
                logger.warn(`[Conversation] Unknown step or unhandled message: ${session.currentStep}, Message: ${messageText}`);
                reply = "I'm not sure how to respond to that. Please type 'menu' to see what I can do, or 'reset' to start over.";
                break;
        }

        return reply;
    },

    // Export validateChoice and parseDateInput if they are used elsewhere directly
    // or keep them as internal helpers if only used within conversationService.js
    parseDateInput: parseDateInput,
    validateChoice: validateChoice
};

module.exports = conversationService;
