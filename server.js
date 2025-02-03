const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const dbConnector = require('./config/connect.js');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
    console.log(`Server is running on ${PORT}`);
})
dbConnector();
