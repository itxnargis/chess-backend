const express = require('express');
const { route } = require('./userRoutes');
const router = express.Router();


router.get('/', (req, res) => {
  res.send(JSON.stringify(req.user));
});

router.get('/settings', (req, res) => {
  res.send('User Profile Settings Page');
});

module.exports = router;