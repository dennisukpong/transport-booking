// models/Route.js
const mongoose = require('mongoose');

const routeSchema = new mongoose.Schema({
    origin: {
        type: String,
        required: true,
        trim: true,
        uppercase: true // Standardize origin/destination to uppercase
    },
    destination: {
        type: String,
        required: true,
        trim: true,
        uppercase: true
    },
    basePrice: { // Base price for the route
        type: Number,
        required: true,
        min: 0
    },
    duration: { // Estimated travel time in minutes
        type: Number,
        min: 0,
        default: 0
    },
    isActive: { // Can be disabled if route is temporarily unavailable
        type: Boolean,
        default: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

routeSchema.index({ origin: 1, destination: 1 }, { unique: true }); // Ensure unique routes

module.exports = mongoose.model('Route', routeSchema);
