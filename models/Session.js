// models/Session.js
const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
    waId: {
        type: String,
        unique: true,
        required: true,
        index: true
    },
    currentStep: {
        type: String,
        enum: [
            'welcome',
            'ask_origin',
            'ask_destination',
            'ask_date',
            'ask_departure_choice', // Ensure this is present
            'ask_passengers',
            'review_booking',
            'awaiting_payment',
            'booking_complete',
            'main_menu',
            'inactive'
        ],
        default: 'welcome'
    },
    bookingDetails: {
        origin: { type: String, trim: true, default: null },
        destination: { type: String, trim: true, default: null },
        date: { type: Date, default: null },
        passengers: { type: Number, default: null },
        departureId: { type: mongoose.Schema.Types.ObjectId, default: null },
        fare: { type: Number, default: null },
        totalAmount: { type: Number, default: null }, // <--- ADD THIS LINE!
    },
    context: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    lastActive: {
        type: Date,
        default: Date.now,
        expires: '2h'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

sessionSchema.pre('save', function(next) {
    this.lastActive = Date.now();
    next();
});

module.exports = mongoose.model('Session', sessionSchema);
