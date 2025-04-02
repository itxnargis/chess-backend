const jwt = require("jsonwebtoken")
require("dotenv").config()

// Improved auth middleware with better error handling
async function restrictToLoginUserOnly(req, res, next) {
  const userToken = req.cookies?.token

  if (!userToken) {
    console.log("No token found in cookies")
    return res.status(401).json({ error: "Unauthorized. Please log in." })
  }

  try {
    // Verify the token directly
    const decoded = jwt.verify(userToken, process.env.JWT_SECRET)

    if (!decoded || !decoded.userId) {
      console.error("Invalid token payload")
      return res.status(403).json({ error: "Invalid token. Please log in again." })
    }

    // Log successful authentication
    console.log(`User authenticated: ${decoded.username} (${decoded.userId})`)

    // Attach user data to request
    req.user = decoded
    req.userId = decoded.userId
    next()
  } catch (error) {
    console.error("Auth middleware error:", error)

    // More specific error messages based on JWT error types
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Your session has expired. Please log in again." })
    } else if (error.name === "JsonWebTokenError") {
      return res.status(403).json({ error: "Invalid token. Please log in again." })
    }

    return res.status(403).json({ error: "Authentication error. Please log in again." })
  }
}

module.exports = { restrictToLoginUserOnly }

