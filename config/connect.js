const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config();

const dbConnector = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URL);
        console.log("MongoDB Connected");
    } catch (error) {
        console.error("MongoDB Connection Error:", error);
    }
}

module.exports = dbConnector;