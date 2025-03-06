const { createServer } = require("http")
const { Server } = require("socket.io")
const express = require("express")
const cors = require("cors")
const dotenv = require("dotenv")
const axios = require("axios")
const userRoutes = require("./routes/userRoutes.js")
const cookieParser = require("cookie-parser")
const { restrictToLoginUserOnly } = require("./middlewares/auth.js")
const path = require("path")
dotenv.config()
const dbConnector = require("./config/connect.js")
const profileRoutes = require("./routes/profileRoutes.js")

dbConnector()

const PORT = process.env.PORT || 8080
const app = express()
const httpServer = createServer(app)

const corsOptions = {
  origin: "https://chess-frontend-dun.vercel.app",
  methods: ["GET", "POST"],
  credentials: true,
}

app.use(cors(corsOptions))
app.use(express.json())
app.use(cookieParser())

const frontendPath = path.resolve(__dirname, "../frontend/dist")

app.use(express.static(frontendPath))

app.use("/user", userRoutes)
app.use("/profile", restrictToLoginUserOnly, profileRoutes)

app.get("/stockfish", async (req, res) => {
  try {
    const apiUrl = "https://stockfish.online/api/s/v2.php"
    const response = await axios.get(apiUrl, {
      params: req.query,
    })

    res.json({
      bestMove: response.data.bestmove,
    })
  } catch (error) {
    res.status(500).send(`Error: ${error.message}`)
  }
})
app.get("*", (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"))
})

// Setup Socket.io
const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true,
  },
})

// Track all waiting players
let waitingPlayers = []
// Track active games
const activeGames = new Map()

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`)

  const user = socket.handshake.query.user ? JSON.parse(socket.handshake.query.user) : null
  if (!user) {
    console.error("User not found in handshake query")
    return
  }

  // Add to waiting players
  waitingPlayers.push({
    socketId: socket.id,
    user: user,
  })

  console.log(`Waiting players: ${waitingPlayers.length}`)

  // Send waiting status to the client
  socket.emit("waiting", true)

  // Check if we have enough players to start a game
  if (waitingPlayers.length >= 2) {
    const player1 = waitingPlayers.shift()
    const player2 = waitingPlayers.shift()

    console.log(`Starting game between ${player1.user.username} and ${player2.user.username}`)

    // Create a game ID
    const gameId = `game_${Date.now()}`

    // Store game info
    activeGames.set(gameId, {
      player1: player1,
      player2: player2,
      moves: [],
    })

    // Associate players with this game
    const player1Socket = io.sockets.sockets.get(player1.socketId)
    const player2Socket = io.sockets.sockets.get(player2.socketId)

    if (player1Socket) player1Socket.data = { gameId }
    if (player2Socket) player2Socket.data = { gameId }

    // Assign colors and send game start info
    io.to(player1.socketId).emit("color", "white")
    io.to(player2.socketId).emit("color", "black")

    io.to(player1.socketId).emit("opponent", player2.user)
    io.to(player2.socketId).emit("opponent", player1.user)
  }

  // Handle get waiting count requests
  socket.on("getWaitingCount", () => {
    socket.emit("waitingCount", waitingPlayers.length)
  })

  // Handle moves
  socket.on("move", (moveData) => {
    const gameId = socket.data?.gameId
    if (!gameId) {
      console.error("Move received but player is not in a game")
      return
    }

    const game = activeGames.get(gameId)
    if (!game) {
      console.error("Game not found:", gameId)
      return
    }

    // Store the move
    game.moves.push(moveData)

    // Forward the move to the opponent
    const isPlayer1 = game.player1.socketId === socket.id
    const opponentSocketId = isPlayer1 ? game.player2.socketId : game.player1.socketId

    io.to(opponentSocketId).emit("move", moveData)
  })

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`)

    // Remove from waiting players
    waitingPlayers = waitingPlayers.filter((p) => p.socketId !== socket.id)

    // Check if player is in a game
    const gameId = socket.data?.gameId
    if (gameId) {
      const game = activeGames.get(gameId)
      if (game) {
        // Notify opponent
        const isPlayer1 = game.player1.socketId === socket.id
        const opponentSocketId = isPlayer1 ? game.player2.socketId : game.player1.socketId

        io.to(opponentSocketId).emit("opponentDisconnected")

        // Remove game
        activeGames.delete(gameId)
      }
    }
  })
})

httpServer.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)
})

