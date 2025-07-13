// models/Booking.js
const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
    userId: { // References the WhatsApp user ID (or your internal User model ID)
        type: String, // Keeping it as String for now, matching waId
        required: true
    },
    sessionId: { // References the session that created this booking
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Session',
        required: true
    },
    departure: { // Reference to the specific departure chosen
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Departure',
        required: true
    },
    passengers: {
        type: Number,
        required: true,
        min: 1
    },
    totalAmount: { // Final amount charged for this booking
        type: Number,
        required: true,
        min: 0
    },
    bookingReference: { // Unique reference code for the user
        type: String,
        unique: true,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'confirmed', 'cancelled', 'completed', 'failed'],
        default: 'pending'
    },
    paymentStatus: {
        type: String,
        enum: ['pending', 'paid', 'refunded'],
        default: 'pending'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Generate a simple booking reference before saving
bookingSchema.pre('save', function(next) {
    if (this.isNew && !this.bookingReference) {
        // Simple alphanumeric reference. For production, consider UUID or similar.
        this.bookingReference = Math.random().toString(36).substring(2, 10).toUpperCase();
    }
    next();
});

module.exports = mongoose.model('Booking', bookingSchema);
