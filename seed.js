// scripts/seed.js
const mongoose = require('mongoose');
const Route = require('../models/Route'); // Adjusted path
const Vehicle = require('../models/Vehicle'); // Adjusted path
const Departure = require('../models/Departure'); // Adjusted path
const logger = require('../utils/logger'); // Use logger.js for logging
const dotenv = require('dotenv');

dotenv.config();

const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/transport_booking_db';

const seedData = async () => {
    try {
        await mongoose.connect(mongoUri, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        logger.info('MongoDB connected for seeding.');

        // Clear existing data (optional, but good for clean re-seeding)
        await Promise.all([
            Route.deleteMany({}),
            Vehicle.deleteMany({}),
            Departure.deleteMany({})
        ]);
        logger.info('Existing data cleared.');

        // --- 1. Create Vehicles ---
        const vehicles = await Vehicle.insertMany([
            { name: 'ABC Transport Bus', type: 'Bus', capacity: 45, amenities: ['AC', 'WiFi'] },
            { name: 'God Is Good Motors', type: 'Bus', capacity: 30, amenities: ['AC'] },
            { name: 'Young Shall Grow Bus', type: 'Bus', capacity: 50, amenities: ['AC', 'Entertainment'] }
        ]);
        logger.info(`Seeded ${vehicles.length} vehicles.`);

        // --- 2. Create Routes ---
        const routes = await Route.insertMany([
            { origin: 'ABUJA', destination: 'LAGOS', distanceKm: 500, travelTimeHours: 8, isActive: true },
            { origin: 'ABUJA', destination: 'UYO', distanceKm: 700, travelTimeHours: 12, isActive: true },
            { origin: 'LAGOS', destination: 'ABUJA', distanceKm: 500, travelTimeHours: 8, isActive: true },
            { origin: 'UYO', destination: 'LAGOS', distanceKm: 700, travelTimeHours: 12, isActive: true },
            { origin: 'LAGOS', destination: 'UYO', distanceKm: 650, travelTimeHours: 11, isActive: true }
        ]);
        logger.info(`Seeded ${routes.length} routes.`);

        // --- 3. Create Departures for the next N days for each route ---
        const numDaysToSeed = 7; // Seed departures for the next 7 days
        const departuresToInsert = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Normalize to start of day for accurate date math

        for (let i = 0; i < numDaysToSeed; i++) {
            const date = new Date(today);
            date.setDate(today.getDate() + i); // Get current day + i days

            // Define specific times for departures (e.g., morning, afternoon) in local time
            const departureTimes = [
                new Date(date.getFullYear(), date.getMonth(), date.getDate(), 7, 0, 0),  // 7:00 AM local time
                new Date(date.getFullYear(), date.getMonth(), date.getDate(), 14, 0, 0) // 2:00 PM local time
            ];

            routes.forEach(route => {
                departureTimes.forEach(time => {
                    // Mongoose (and Node's Date object) generally handles local time conversion to UTC on save
                    // If your system's locale is Nigeria/WAT, new Date(...) will create a WAT date.
                    // When saved to MongoDB, it's converted to UTC.
                    // The query in conversationService then correctly queries in terms of UTC for the corresponding day.
                    departuresToInsert.push({
                        route: route._id,
                        vehicle: vehicles[Math.floor(Math.random() * vehicles.length)]._id, // Pick a random vehicle
                        departureTime: time, // Using the local Date object directly
                        fare: route.distanceKm * 30, // Example fare calculation
                        availableSeats: 30 + Math.floor(Math.random() * 10), // Random seats
                        status: 'scheduled'
                    });
                });
            });
        }

        await Departure.insertMany(departuresToInsert);
        logger.info(`Seeded ${departuresToInsert.length} departures.`);

        logger.info('Database seeding complete!');

    } catch (error) {
        logger.error('Error during seeding:', error.message, error); // Log full error for debugging
        process.exit(1);
    } finally {
        await mongoose.disconnect();
    }
};

seedData();