// Fix the JWT secret issue
const jwt = require("jsonwebtoken")
require("dotenv").config() // Make sure dotenv is loaded

// Get the JWT secret from environment variables
const secret = process.env.JWT_SECRET

// Add validation to ensure the secret exists
if (!secret) {
  console.error("❌ JWT_SECRET is not defined in environment variables!")
  // In production, you might want to exit the process
  // process.exit(1);
}

function generateToken(user) {
  if (!secret) {
    throw new Error("JWT_SECRET is not defined")
  }
  return jwt.sign(user, secret, { expiresIn: "4h" })
}

function getUser(token) {
  if (!token) {
    console.error("❌ No token provided")
    return null
  }

  if (!secret) {
    console.error("❌ JWT_SECRET is not defined")
    return null
  }

  try {
    const decoded = jwt.verify(token, secret)
    console.log("✅ Token verified successfully")
    return decoded
  } catch (error) {
    console.error("❌ Token verification error:", error.message)

    // Check if token is expired
    if (error.name === "TokenExpiredError") {
      console.error("❌ Token has expired")
    }

    return null
  }
}

module.exports = { generateToken, getUser }

