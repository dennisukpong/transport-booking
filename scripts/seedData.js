// scripts/seedData.js
require('dotenv').config({ path: './.env' }); // Ensure .env is loaded for MONGO_URI
const mongoose = require('mongoose');
const config = require('./../config');
const logger = require('./../utils/logger'); // Using existing logger

// Import models
const Route = require('./../models/Route');
const Vehicle = require('./../models/Vehicle');
const Departure = require('./../models/Departure');

const seedData = async () => {
    try {
        await mongoose.connect(config.mongoURI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        logger.info('MongoDB connected for seeding.');

        // Clear existing data (use with caution in production)
        await Route.deleteMany({});
        await Vehicle.deleteMany({});
        await Departure.deleteMany({});
        logger.info('Existing data cleared.');

        // 1. Seed Vehicles
        const vehicles = await Vehicle.insertMany([
            { name: 'Standard Bus', type: 'bus', capacity: 40, features: ['AC'], priceModifier: 1.0 },
            { name: 'Luxury Bus', type: 'bus', capacity: 30, features: ['AC', 'WiFi', 'Reclining Seats'], priceModifier: 1.2 },
            { name: 'Mini-Van', type: 'van', capacity: 10, features: ['AC'], priceModifier: 1.5 }
        ]);
        logger.info(`Seeded ${vehicles.length} vehicles.`);

        // 2. Seed Routes
        const routes = await Route.insertMany([
            { origin: 'UYO', destination: 'LAGOS', basePrice: 15000, duration: 1200 }, // 20 hours
            { origin: 'UYO', destination: 'ABUJA', basePrice: 20000, duration: 1080 }, // 18 hours
            { origin: 'LAGOS', destination: 'UYO', basePrice: 15000, duration: 1200 },
            { origin: 'ABUJA', destination: 'UYO', basePrice: 20000, duration: 1080 }
        ]);
        logger.info(`Seeded ${routes.length} routes.`);

        // 3. Seed Departures
        const today = new Date();
        today.setHours(0,0,0,0);
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);

        const departuresToSeed = [];

        // Example Departures for UYO-LAGOS
        const uyoLagosRoute = routes.find(r => r.origin === 'UYO' && r.destination === 'LAGOS');
        const standardBus = vehicles.find(v => v.name === 'Standard Bus');
        const luxuryBus = vehicles.find(v => v.name === 'Luxury Bus');

        if (uyoLagosRoute && standardBus && luxuryBus) {
            // Today's departures
            departuresToSeed.push({
                route: uyoLagosRoute._id,
                vehicle: standardBus._id,
                departureTime: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 0), // 9:00 AM today
                availableSeats: standardBus.capacity,
                fare: uyoLagosRoute.basePrice * standardBus.priceModifier
            });
            departuresToSeed.push({
                route: uyoLagosRoute._id,
                vehicle: luxuryBus._id,
                departureTime: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 14, 0), // 2:00 PM today
                availableSeats: luxuryBus.capacity,
                fare: uyoLagosRoute.basePrice * luxuryBus.priceModifier
            });

            // Tomorrow's departures
            departuresToSeed.push({
                route: uyoLagosRoute._id,
                vehicle: standardBus._id,
                departureTime: new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 9, 0), // 9:00 AM tomorrow
                availableSeats: standardBus.capacity,
                fare: uyoLagosRoute.basePrice * standardBus.priceModifier
            });
            departuresToSeed.push({
                route: uyoLagosRoute._id,
                vehicle: luxuryBus._id,
                departureTime: new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 14, 0), // 2:00 PM tomorrow
                availableSeats: luxuryBus.capacity,
                fare: uyoLagosRoute.basePrice * luxuryBus.priceModifier
            });
        }

        // Example Departures for UYO-ABUJA
        const uyoAbujaRoute = routes.find(r => r.origin === 'UYO' && r.destination === 'ABUJA');
        if (uyoAbujaRoute && standardBus) {
             departuresToSeed.push({
                route: uyoAbujaRoute._id,
                vehicle: standardBus._id,
                departureTime: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10, 0), // 10:00 AM today
                availableSeats: standardBus.capacity,
                fare: uyoAbujaRoute.basePrice * standardBus.priceModifier
            });
        }


        const departures = await Departure.insertMany(departuresToSeed);
        logger.info(`Seeded ${departures.length} departures.`);

        logger.info('Seeding completed successfully!');

    } catch (error) {
        logger.error(`Error during seeding: ${error.message}`, { error: error });
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        logger.info('MongoDB disconnected.');
    }
};

seedData();
