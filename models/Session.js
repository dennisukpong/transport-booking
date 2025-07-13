// models/Session.js
const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
    waId: {
        type: String,
        unique: true,
        required: true,
        index: true // Add index for faster lookup
    },
    currentStep: {
        type: String,
        enum: [
            'welcome',              // Initial state
            'ask_origin',           // Prompting for departure city
            'ask_destination',      // Prompting for destination city
            'ask_date',             // Prompting for travel date
            'ask_passengers',       // Prompting for number of passengers
            'review_booking',       // User reviewing gathered details
            'awaiting_payment',     // Booking confirmed, waiting for payment (future step)
            'booking_complete',     // Booking finalized
            'main_menu',            // For returning to a menu after a flow
            'inactive'              // Session ended or timed out
        ],
        default: 'welcome'
    },
    bookingDetails: {
        origin: { type: String, trim: true, default: null },
        destination: { type: String, trim: true, default: null },
        date: { type: Date, default: null },
        passengers: { type: Number, default: null },
        // Add more fields as needed, e.g., tripId, vehicleType, price, etc.
        // For MVP, keep it simple.
    },
    context: { // For storing temporary conversational context (e.g., last invalid input)
        type: mongoose.Schema.Types.Mixed, // Allows flexible data types
        default: {}
    },
    lastActive: {
        type: Date,
        default: Date.now,
        expires: '2h' // Sessions expire after 2 hours of inactivity (adjust as needed)
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Update lastActive on every save
sessionSchema.pre('save', function(next) {
    this.lastActive = Date.now();
    next();
});

module.exports = mongoose.model('Session', sessionSchema);
