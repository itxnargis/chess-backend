
const { getUser } = require("../services/auth")

async function restrictToLoginUserOnly(req, res, next) {
  const userToken = req.cookies?.token

  if (!userToken) {
    console.log("No token found in cookies")
    return res.status(401).json({ error: "Unauthorized. Please log in." })
  }

  try {
    const user = getUser(userToken)
    if (!user) {
      console.error("Invalid token or user not found")
      return res.status(403).json({ error: "Invalid token. Please log in again." })
    }

    req.user = user
    next()
  } catch (error) {
    console.error("Auth middleware error:", error)
    return res.status(403).json({ error: "Authentication error. Please log in again." })
  }
}

module.exports = { restrictToLoginUserOnly }

