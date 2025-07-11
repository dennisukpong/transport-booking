// models/Session.js
const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
    waId: { type: String, unique: true, required: true },
    currentStep: { type: String, default: 'welcome' }, // e.g., 'select_departure', 'confirm_booking'
    bookingDetails: {
        departure: String,
        destination: String,
        date: Date,
        time: String,
        passengers: { type: Number, default: 0 },
        names: [String],
        // tempBookingId: String, // Might be useful for tracking pending
        // vehicleId: mongoose.Schema.Types.ObjectId, // For multi-vehicle, if pre-assigned
        price: Number,
    },
    context: { type: Object, default: {} }, // For NLP context, e.g., last mentioned city
    lastActive: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Session', sessionSchema);
