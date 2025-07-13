// models/Vehicle.js
const mongoose = require('mongoose');

const vehicleSchema = new mongoose.Schema({
    name: { // e.g., "Luxury Bus", "Standard Mini-Bus"
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    type: { // e.g., 'bus', 'van', 'car'
        type: String,
        required: true,
        enum: ['bus', 'van', 'car', 'private'], // Define allowed types
        lowercase: true
    },
    capacity: { // Max number of passengers
        type: Number,
        required: true,
        min: 1
    },
    features: [String], // e.g., ['AC', 'WiFi', 'Reclining Seats']
    priceModifier: { // Can be used to adjust base price for vehicle type
        type: Number,
        default: 1.0 // 1.0 means no change, 1.2 means 20% increase
    },
    isActive: {
        type: Boolean,
        default: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Vehicle', vehicleSchema);
