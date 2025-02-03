require("dotenv").config();
const jwt = require("jsonwebtoken");
const secret = process.env.JWT_SECRET;

function getUser(token) {
    if (!token) {
        console.error("No token provided");
        return null;
    }

    try {
        return jwt.verify(token, secret);
    } catch (error) {
        console.error('Token verification error:', error.message);
        return null;
    }
}

module.exports = {
    getUser
};