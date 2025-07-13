// services/conversationService.js
const sessionService = require('./sessionService');
const whatsappService = require('./whatsappService');
const logger = require('../utils/logger');
const Route = require('../models/Route');     // New Import
const Departure = require('../models/Departure'); // New Import
const Booking = require('../models/Booking');   // New Import

// Helper for sending messages based on step
const sendReply = async (waId, message, twiml) => {
    if (twiml) {
        twiml.message(message);
    } else {
        // This path is for asynchronous replies, not used for immediate webhook responses
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
                        const origins = await Route.distinct('origin', { isActive: true });
                        if (origins && origins.length > 0) {
                            reply = "Great! Where would you like to **depart from**?\n\n" +
                                    origins.map((o, i) => `*${i + 1}.* ${o}`).join('\n') +
                                    "\n\nPlease reply with the city name or number.";
                            await sessionService.updateSessionContext(waId, { availableOrigins: origins });
                            await sessionService.updateSessionStep(waId, 'ask_origin');
                        } else {
                            reply = "Sorry, no departure locations are currently available. Please try again later.";
                            await sessionService.updateSessionStep(waId, 'welcome');
                        }
                    } else if (messageText === '2' || messageText.includes('check')) {
                        reply = "Sure, to check your booking, please provide your booking reference number (future step).";
                        await sessionService.updateSessionStep(waId, 'welcome');
                    } else if (messageText === '3' || messageText.includes('contact')) {
                        reply = "You can contact our support team at +2348012345678 or email support@transport.com.";
                        await sessionService.updateSessionStep(waId, 'main_menu');
                    } else {
                        reply = "Please choose an option by typing the number or a keyword (e.g., '1' or 'book').";
                    }
                    break;

                case 'ask_origin':
                    const availableOrigins = session.context.availableOrigins || [];
                    const chosenOrigin = conversationService.validateChoice(messageText, availableOrigins);

                    if (chosenOrigin) {
                        await sessionService.updateBookingDetails(waId, { origin: chosenOrigin.toUpperCase() }); // Store as uppercase
                        const destinations = await Route.distinct('destination', { origin: chosenOrigin.toUpperCase(), isActive: true });
                        if (destinations && destinations.length > 0) {
                            reply = `Okay, from ${chosenOrigin}. Where would you like to **go to**?\n\n` +
                                    destinations.map((d, i) => `*${i + 1}.* ${d}`).join('\n') +
                                    "\n\nPlease reply with the city name or number.";
                            await sessionService.updateSessionContext(waId, { availableDestinations: destinations });
                            await sessionService.updateSessionStep(waId, 'ask_destination');
                        } else {
                            reply = `Sorry, no destinations available from ${chosenOrigin}. Please choose a different origin or type 'reset'.`;
                            await sessionService.resetSession(waId);
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
                    const availableDestinations = session.context.availableDestinations || [];
                    const chosenDestination = conversationService.validateChoice(messageText, availableDestinations);

                    if (chosenDestination) {
                        await sessionService.updateBookingDetails(waId, { destination: chosenDestination.toUpperCase() }); // Store as uppercase
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
                    const parsedDate = conversationService.parseDateInput(messageText);
                    if (parsedDate && parsedDate >= new Date(new Date().setHours(0,0,0,0))) { // Date must be today or in future
                        await sessionService.updateBookingDetails(waId, { date: parsedDate });
                        const { origin, destination } = session.bookingDetails;
                        const route = await Route.findOne({ origin: origin, destination: destination, isActive: true });

                        if (route) {
                            const departures = await Departure.find({
                                route: route._id,
                                departureTime: {
                                    $gte: new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate(), 0, 0, 0),
                                    $lt: new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate(), 23, 59, 59)
                                },
                                availableSeats: { $gt: 0 },
                                status: 'scheduled'
                            }).populate('vehicle').sort('departureTime');

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
                            } else {
                                reply = `Sorry, no available departures found for ${origin} to ${destination} on ${parsedDate.toDateString()}. Please choose another date or type 'reset'.`;
                                await sessionService.updateSessionStep(waId, 'ask_date');
                            }
                        } else {
                            reply = "Internal error: Route not found for selected origin and destination. Please type 'reset' to start over.";
                            await sessionService.resetSession(waId);
                        }
                    } else {
                        reply = "I couldn't understand that date or it's in the past. Please provide the date in format YYYY-MM-DD (e.g., 2025-07-20), 'tomorrow', or 'next [day of week]'.";
                    }
                    break;

                case 'ask_departure_choice':
                    const availableDepartures = session.context.availableDepartures || [];
                    const chosenIndex = parseInt(messageText, 10) - 1;

                    if (!isNaN(chosenIndex) && chosenIndex >= 0 && chosenIndex < availableDepartures.length) {
                        const chosenDepartureId = availableDepartures[chosenIndex];
                        const chosenDeparture = await Departure.findById(chosenDepartureId).populate('vehicle');

                        if (chosenDeparture) {
                            await sessionService.updateBookingDetails(waId, {
                                departureId: chosenDepartureId,
                                fare: chosenDeparture.fare // Store the fare for this specific departure
                            });
                            reply = `You've selected the ${chosenDeparture.vehicle.name} departing at ${new Date(chosenDeparture.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.\nHow many **passengers** will there be? (Enter a number)`;
                            await sessionService.updateSessionStep(waId, 'ask_passengers');
                        } else {
                            reply = "Something went wrong with selecting that departure. Please try again or type 'reset'.";
                            await sessionService.resetSession(waId);
                        }
                    } else {
                        reply = "Invalid selection. Please reply with the number of your preferred departure from the list.";
                        // Optionally re-list departures from session context if available, but it might be too long
                    }
                    break;

                case 'ask_passengers':
                    const numPassengers = parseInt(messageText, 10);
                    const currentDepartureId = session.bookingDetails.departureId;
                    const departureToBook = await Departure.findById(currentDepartureId);

                    if (departureToBook && !isNaN(numPassengers) && numPassengers > 0 && numPassengers <= departureToBook.availableSeats) {
                        await sessionService.updateBookingDetails(waId, { passengers: numPassengers });
                        const updatedSession = await sessionService.getSession(waId); // Fetch updated session for review
                        const { origin, destination, passengers, departureId } = updatedSession.bookingDetails;
                        const finalDeparture = await Departure.findById(departureId).populate('route').populate('vehicle');

                        if (finalDeparture) {
                            const totalAmount = finalDeparture.fare * passengers;
                            await sessionService.updateBookingDetails(waId, { totalAmount: totalAmount });

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
                        }

                    } else if (departureToBook && (numPassengers <= 0 || numPassengers > departureToBook.availableSeats)) {
                        reply = `Please enter a valid number of passengers (1 to ${departureToBook.availableSeats}).`;
                    } else {
                        reply = "Please enter a valid number of passengers.";
                    }
                    break;

                case 'review_booking':
                    if (messageText === 'yes') {
                        const updatedSession = await sessionService.getSession(waId);
                        const { departureId, passengers, totalAmount } = updatedSession.bookingDetails;

                        if (departureId && passengers && totalAmount) {
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

                            // Atomically reduce available seats
                            await Departure.findByIdAndUpdate(departureId, { $inc: { availableSeats: -passengers } });

                            reply = `Excellent! Your booking for NGN${totalAmount.toLocaleString()} has been reserved (Reference: *${newBooking.bookingReference}*).\n\n` +
                                    "Payment instructions will follow (future step).\n\n" +
                                    "Thank you for booking with us!";
                            await sessionService.updateSessionStep(waId, 'booking_complete');
                        } else {
                            reply = "Missing booking details. Please try 'reset' and start over.";
                            await sessionService.resetSession(waId);
                        }

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
                    await sessionService.updateSessionStep(waId, 'welcome');
                    break;

                default:
                    reply = "I'm sorry, I don't understand that. Please type 'menu' to see options.";
                    // Optionally, if the user sends an unknown message, try to re-prompt based on current step
                    // For now, reset to welcome for simplicity.
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
                // Calculate next occurrence of the day
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
                    // Check if date is valid (e.g., Feb 30 becomes March 2, we want to reject it)
                    if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
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
    },

    /**
     * Helper function to validate user input against a list of options (text or number).
     * @param {string} input - User's message text.
     * @param {Array<string>} options - Array of valid string options.
     * @returns {string|null} The matched option (original case) or null if no match.
     */
    validateChoice: (input, options) => {
        // Try to match by exact text (case-insensitive)
        const matchedByText = options.find(opt => opt.toLowerCase() === input.toLowerCase());
        if (matchedByText) {
            return matchedByText;
        }

        // Try to match by number (1-indexed)
        const chosenIndex = parseInt(input, 10);
        if (!isNaN(chosenIndex) && chosenIndex >= 1 && chosenIndex <= options.length) {
            return options[chosenIndex - 1];
        }

        return null; // No valid choice found
    }
};

module.exports = conversationService;
