const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const User = require("../models/userModel");
const { use } = require("framer-motion/client");

const register = async (req, res) => {
    const { username, password, email } = req.body;

    const lowerCaseUsername = username.toLowerCase();
    const lowerCaseEmail = email.toLowerCase();

    try {
        const existingUser = await User.findOne({ email: lowerCaseEmail });
        if (existingUser) {
            return res.status(400).json({
                error: "Email already in use"
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = new User({
            username: lowerCaseUsername,
            password: hashedPassword,
            email: lowerCaseEmail
        });

        await newUser.save();
        res.status(201).json({
            message: "User registered successfully"
        });

    } catch (error) {
        res.status(500).json({ error: err.message });
    }
};

const login = async (req, res) => {
    const { email, password } = req.body;
  
    // Convert to lowercase
    const lowerCaseEmail = email.toLowerCase();
  
    try {
      const user = await User.findOne({ email: lowerCaseEmail });
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
  
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(400).json({ error: 'Invalid credentials' });
      }
  
      const token = jwt.sign({
        userId: user._id,
        username: user.username,
        email: user.email,
        matchHistory: user.matchHistory,
        wins: user.wins,
        loses: user.loses,
        draws: user.draws
      }, process.env.JWT_SECRET, {
        expiresIn: '4h'
      });
  
      res.cookie('token', token, {
        httpOnly: true,
        maxAge: 3600000,
        secure: false
      });
  
      res.status(200).json({
        token,
      });
  
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };

const getUserById = async (req, res) => {
    const { userId } = req.params;

    try {
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.status(200).json({ user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const addMatchToHistory = async (req, res) => {
    const { userId } = req.params;
    const { opponent, status } = req.body;

    try {
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        user.matchHistory.push({ opponent, status });

        if (status === 'win') {
            user.wins++;
        } else if (status === 'lose') {
            user.loses++;
        } else if (status === 'draw') {
            user.draws++;
        }

        await user.save();

        res.status(201).json({ message: 'Match history added successfully', user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const getMatchHistory = async (req, res) => {
    const { userId } = req.params;

    try {
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.status(200).json({ matchHistory: user.matchHistory });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

module.exports = {
    register,
    login,
    getUserById,
    addMatchToHistory,
    getMatchHistory
};