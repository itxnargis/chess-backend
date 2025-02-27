const { getUser } = require("../services/auth");

async function restrictToLoginUserOnly(req, res, next) {
    const userToken = req.cookies?.token;

    if (!userToken) {
        console.log("No token found in cookies");
        return res.status(401).json({ error: "Unauthorized. Please log in." });
    }

    const user = getUser(userToken);
    if (!user) {
        console.error("Invalid token or user not found");
        return res.status(403).json({ error: "Invalid token. Please log in again." });
    }

    req.user = user;
    next();
}

module.exports = { restrictToLoginUserOnly };
