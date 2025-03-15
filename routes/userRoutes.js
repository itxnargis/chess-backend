const express = require("express");
const router = express.Router();
const userController = require("../controllers/UserController");

router.post('/register', userController.register);

router.post('/login', userController.login);

router.post("/logout", userController.logout)

router.get('/:userId', userController.getUserById);

router.post('/:userId/match-history', userController.addMatchToHistory);

router.get('/:userId/match-history', userController.getMatchHistory);

module.exports = router;