const bcrypt = require("bcryptjs")
const jwt = require("jsonwebtoken")
const User = require("../models/userModel")
require("dotenv").config()


if (!process.env.JWT_SECRET) {
  console.error("❌ JWT_SECRET is not defined in UserController!")
}

const register = async (req, res) => {
  try {
    const { username, email, password } = req.body

    // Validate input
    if (!username || !email || !password) {
      return res.status(400).json({ error: "Please provide all required fields" })
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email })
    if (existingUser) {
      return res.status(400).json({ error: "User already exists" })
    }

    // Hash the password
    const salt = await bcrypt.genSalt(10)
    const hashedPassword = await bcrypt.hash(password, salt)

    // Create new user
    const newUser = new User({
      username,
      email,
      password: hashedPassword,
    })

    // Save user to database
    await newUser.save()

    res.status(201).json({ message: "User registered successfully" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

const login = async (req, res) => {
  const { email, password } = req.body

  const lowerCaseEmail = email.toLowerCase()

  try {
    const user = await User.findOne({ email: lowerCaseEmail })
    if (!user) {
      return res.status(404).json({ error: "User not found" })
    }

    const isMatch = await bcrypt.compare(password, user.password)
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid credentials" })
    }

    // Create a smaller payload for the token to avoid cookie size issues
    const tokenPayload = {
      userId: user._id,
      username: user.username,
      email: user.email,
    }

    // Create a more complete user object for the response
    const userResponse = {
      userId: user._id,
      username: user.username,
      email: user.email,
      matchHistory: user.matchHistory,
      wins: user.wins,
      loses: user.loses,
      draws: user.draws,
    }

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
      expiresIn: "4h",
    })

    // Set a smaller cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax", // Changed from 'none' to 'lax' for better compatibility
      maxAge: 4 * 60 * 60 * 1000, // 4 hours in milliseconds
    })

    // Return both token and user data
    res.status(200).json({
      token,
      ...userResponse,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

const logout = (req, res) => {
  res.clearCookie("token")
  res.status(200).json({ message: "Logged out successfully" })
}
const getUserProfile = async (req, res) => {
  try {
    const userId = req.userId // Extracted from the auth middleware
    const user = await User.findById(userId).select("-password") // Exclude password from the response

    if (!user) {
      return res.status(404).json({ message: "User not found" })
    }

    res.status(200).json(user)
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: "Server error" })
  }
}

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
    getUserProfile,
    addMatchToHistory,
    getMatchHistory,
    logout,
};