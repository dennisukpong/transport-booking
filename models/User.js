// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    waId: { type: String, unique: true, required: true }, // WhatsApp ID (e.g., 23480xxxxxxxx)
    language: { type: String, default: 'en' },
    createdAt: { type: Date, default: Date.now },
    lastActive: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
