// models/Departure.js
const mongoose = require('mongoose');

const departureSchema = new mongoose.Schema({
    route: { // Reference to the Route
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Route',
        required: true
    },
    vehicle: { // Reference to the Vehicle
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Vehicle',
        required: true
    },
    departureTime: { // Specific time of departure
        type: Date,
        required: true
    },
    availableSeats: {
        type: Number,
        required: true,
        min: 0
    },
    fare: { // Final fare for this specific departure (basePrice * priceModifier)
        type: Number,
        required: true,
        min: 0
    },
    status: {
        type: String,
        enum: ['scheduled', 'departed', 'completed', 'cancelled'],
        default: 'scheduled'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

departureSchema.index({ route: 1, departureTime: 1 }, { unique: true }); // One departure per route/time
departureSchema.index({ departureTime: 1 }); // For querying upcoming departures

module.exports = mongoose.model('Departure', departureSchema);
