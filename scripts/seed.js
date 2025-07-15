// scripts/seed.js

// Load environment variables from .env file.
// We explicitly set the path as the script is in a subdirectory.
require('dotenv').config({ path: './.env' });

const mongoose = require('mongoose');
const Route = require('../models/Route');       // Adjusted path
const Vehicle = require('../models/Vehicle');     // Adjusted path
const Departure = require('../models/Departure'); // Adjusted path
const logger = require('../utils/logger');      // Use logger.js for logging

// Retrieve MongoDB URI from environment variables.
// Provide a fallback for local development if MONGODB_URI is not set.
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/transport_booking_db';

// --- Safety Check for MONGODB_URI ---
if (!mongoUri) {
    logger.error('MONGODB_URI is not defined. Please set it in your .env file or as an environment variable.');
    process.exit(1); // Exit if URI is missing
}


const seedData = async () => {
    try {
        await mongoose.connect(mongoUri, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        logger.info('MongoDB connected for seeding.');

        // --- Clear existing data (for clean re-seeding) ---
        await Promise.all([
            Route.deleteMany({}),
            Vehicle.deleteMany({}),
            Departure.deleteMany({})
        ]);
        logger.info('Existing data cleared.');

        // --- 1. Create Vehicles ---
        logger.info('Seeding vehicles...');
        const vehicles = await Vehicle.insertMany([
            { name: 'ABC Transport Bus', type: 'Bus', capacity: 45, amenities: ['AC', 'WiFi'] },
            { name: 'God Is Good Motors', type: 'Bus', capacity: 30, amenities: ['AC'] },
            { name: 'Young Shall Grow Bus', type: 'Bus', capacity: 50, amenities: ['AC', 'Entertainment'] }
        ]);
        logger.info(`Seeded ${vehicles.length} vehicles.`);

        // --- 2. Create Routes ---
        logger.info('Seeding routes...');
        const insertedRoutes = await Route.insertMany([ // Renamed to insertedRoutes
            { origin: 'ABUJA', destination: 'LAGOS', distanceKm: 500, travelTimeHours: 8, isActive: true, basePrice: 15000 },
            { origin: 'ABUJA', destination: 'UYO', distanceKm: 700, travelTimeHours: 12, isActive: true, basePrice: 20000 },
            { origin: 'LAGOS', destination: 'ABUJA', distanceKm: 500, travelTimeHours: 8, isActive: true, basePrice: 15000 },
            { origin: 'UYO', destination: 'LAGOS', distanceKm: 700, travelTimeHours: 12, isActive: true, basePrice: 20000 },
            { origin: 'LAGOS', destination: 'UYO', distanceKm: 650, travelTimeHours: 11, isActive: true, basePrice: 18000 }
        ]);
        logger.info(`Seeded ${insertedRoutes.length} routes.`);

        // Convert Mongoose documents to plain JavaScript objects
        // This ensures properties like distanceKm are pure numbers.
        const routes = insertedRoutes.map(routeDoc => routeDoc.toObject());
        
        // --- 3. Create Departures for the next N days for each route ---
        
        

        logger.info('Seeding departures...');
        const numDaysToSeed = 14;
        const departuresToInsert = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (let i = 0; i < numDaysToSeed; i++) {
            const date = new Date(today);
            date.setDate(today.getDate() + i);

            const departureTimes = [
                new Date(date.getFullYear(), date.getMonth(), date.getDate(), 7, 0, 0),
                new Date(date.getFullYear(), date.getMonth(), date.getDate(), 14, 0, 0)
            ];

            routes.forEach(route => {
                logger.debug(`Processing route: ${route.origin} to ${route.destination}, distanceKm: ${route.distanceKm}, type: ${typeof route.distanceKm}`);

                if (typeof route.distanceKm !== 'number' || isNaN(route.distanceKm)) {
                    logger.error(`(Still) Invalid distanceKm for route ${route.origin} to ${route.destination}. This should not happen after .toObject().`);
                    return;
                }

                departureTimes.forEach(time => {
                    departuresToInsert.push({
                        route: route._id,
                        vehicle: vehicles[Math.floor(Math.random() * vehicles.length)]._id,
                        // --- ADD THIS LINE ---
                        departureTime: time, // Use the 'time' variable from the loop
                        // --- END ADDITION ---
                        fare: route.basePrice,
                        availableSeats: 30 + Math.floor(Math.random() * 10),
                        status: 'scheduled'
                    });
                });
            });
        }

        await Departure.insertMany(departuresToInsert);
        logger.info(`Seeded ${departuresToInsert.length} departures.`);

        logger.info('Database seeding complete!');

    } catch (error) {
        logger.error('Error during seeding:', error);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        logger.info('MongoDB connection closed.');
    }
};

seedData();
        /*
        logger.info('Seeding departures...');
        const numDaysToSeed = 14;
        const departuresToInsert = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (let i = 0; i < numDaysToSeed; i++) {
            const date = new Date(today);
            date.setDate(today.getDate() + i);

            const departureTimes = [
                new Date(date.getFullYear(), date.getMonth(), date.getDate(), 7, 0, 0),
                new Date(date.getFullYear(), date.getMonth(), date.getDate(), 14, 0, 0)
            ];

            routes.forEach(route => { // This 'routes' now contains plain objects
                // The debug log is still useful for verification
                logger.debug(`Processing route: ${route.origin} to ${route.destination}, distanceKm: ${route.distanceKm}, type: ${typeof route.distanceKm}`);

                // The check should now pass if .toObject() fixed it
                if (typeof route.distanceKm !== 'number' || isNaN(route.distanceKm)) {
                    logger.error(`(Still) Invalid distanceKm for route ${route.origin} to ${route.destination}. This should not happen after .toObject().`);
                    return;
                }

                departureTimes.forEach(time => {
                    departuresToInsert.push({
                        route: route._id,
                        vehicle: vehicles[Math.floor(Math.random() * vehicles.length)]._id,
                        fare: route.basePrice, // Use basePrice as discussed
                        availableSeats: 30 + Math.floor(Math.random() * 10),
                        status: 'scheduled'
                    });
                });
            });
        }

        await Departure.insertMany(departuresToInsert);
        logger.info(`Seeded ${departuresToInsert.length} departures.`);

        logger.info('Database seeding complete!');

    } catch (error) {
        logger.error('Error during seeding:', error);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        logger.info('MongoDB connection closed.');
    }
};

seedData();
*/