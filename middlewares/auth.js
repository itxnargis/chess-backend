const { getUser } = require("../services/auth");

async function restrictToLoginUserOnly(req, res, next) {
    const userToken = req.cookies?.token;

    if (!userToken) {
        console.log("No token found in cookies");
        return res.redirect("/login");
    }

    const user = getUser(userToken);
    if (!user) {
        console.error("Invalid token or user not found");
        return res.redirect("/login");
    }

    req.user = user;
    next();
}

module.exports = {
    restrictToLoginUserOnly,
};