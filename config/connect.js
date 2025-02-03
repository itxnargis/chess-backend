const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config();

const dbConnector = async () => {
    await mongoose.connect(process.env.MONGODB_URL)
        .then(() => console.log("MongoDB Connected"))
        .catch((error) => {
            console.log(error)
        })
}

module.exports = dbConnector;