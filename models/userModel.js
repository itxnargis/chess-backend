const mongoose = require("mongoose");

const matchSchema = new mongoose.Schema({
    opponent: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ["win", "lose", "draw"],
        required: true
    },
},
    {
        timestamps: true
    });

const userSchema = new mongoose.Schema({
    username: { type: String, required: true },
    password: { type: String, required: true },
    email: { type: String, unique: true, required: true },
    createdAt: { type: Date, default: Date.now },
    wins: { type: Number, default: 0 },
    loses: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },
    matchHistory: [matchSchema]
})

module.exports = mongoose.model("User", userSchema);