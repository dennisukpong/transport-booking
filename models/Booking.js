// models/Booking.js
const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true
    },
    sessionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Session',
        required: true
    },
    departure: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Departure',
        required: true
    },
    passengers: {
        type: Number,
        required: true,
        min: 1
    },
    totalAmount: {
        type: Number,
        required: true,
        min: 0
    },
    bookingReference: { // Unique reference code for the user
        type: String,
        unique: true,
        required: true // KEEP required: true
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

// --- REMOVE THIS ENTIRE BLOCK ---
// bookingSchema.pre('save', function(next) {
//     if (this.isNew && !this.bookingReference) {
//         this.bookingReference = Math.random().toString(36).substring(2, 10).toUpperCase();
//     }
//     next();
// });
// --- END REMOVAL ---

// --- Add this line to ensure the model is always re-registered fresh (for development) ---
// In a very strict production environment, this might not be ideal,
// but for solving this persistent issue, it's very effective.
if (mongoose.models.Booking) {
    delete mongoose.models.Booking;
}


module.exports = mongoose.model('Booking', bookingSchema);
