const express = require('express');
const { restrictToLoginUserOnly } = require('../middleware/auth');
const router = express.Router();

router.use(restrictToLoginUserOnly);

router.get('/', (req, res) => {
  res.json(req.user);
});

router.get('/settings', (req, res) => {
  res.send('User Profile Settings Page');
});

module.exports = router;