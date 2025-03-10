// This is a modified version of your server.js file with improved socket handling

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
const { Chess } = require("chess.js")

dbConnector()

const PORT = process.env.PORT || 8080
const app = express()
const httpServer = createServer(app)

// Allow requests from all origins in production
const corsOptions = {
  origin: process.env.NODE_ENV === "production" ? true : ["http://localhost:5173", "http://localhost:3000"],
  methods: ["GET", "POST", "PUT", "DELETE"],
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

// Add a health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() })
})

app.get("*", (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"))
})

// Setup Socket.io with improved error handling
const io = new Server(httpServer, {
  cors: corsOptions,
  pingTimeout: 60000, // Increase timeout for better connection stability
  pingInterval: 25000, // Check connection every 25 seconds
})

// Track all waiting players
let waitingPlayers = []
// Track active games
const activeGames = new Map()

// Debug function to log the current state
const logServerState = () => {
  console.log(`[SERVER STATE] Waiting players: ${waitingPlayers.length}, Active games: ${activeGames.size}`)
  if (waitingPlayers.length > 0) {
    console.log(
      `[WAITING PLAYERS] ${JSON.stringify(waitingPlayers.map((p) => ({ id: p.socketId, username: p.user.username })))}`,
    )
  }
}

// Set up periodic logging
setInterval(logServerState, 60000)

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`)

  try {
    const user = socket.handshake.query.user ? JSON.parse(socket.handshake.query.user) : null
    const lastGameId = socket.handshake.query.lastGameId || null

    if (!user || !user.userId) {
      console.error("User not found in handshake query or missing userId")
      socket.emit("error", { message: "Invalid user data" })
      return
    }

    console.log(`User ${user.username} (${user.userId}) connected with socket ${socket.id}`)

    // Check if user is already in a game
    let existingGame = null
    let existingGameId = null

    // First check if they're reconnecting to a specific game
    if (lastGameId && activeGames.has(lastGameId)) {
      existingGame = activeGames.get(lastGameId)
      existingGameId = lastGameId

      // Verify user is part of this game
      if (existingGame.player1.user.userId !== user.userId && existingGame.player2.user.userId !== user.userId) {
        existingGame = null
        existingGameId = null
      }
    }

    // If not found by game ID, search all games
    if (!existingGame) {
      for (const [gameId, game] of activeGames.entries()) {
        if (game.player1.user.userId === user.userId || game.player2.user.userId === user.userId) {
          existingGame = game
          existingGameId = gameId
          break
        }
      }
    }

    if (existingGame) {
      console.log(`User ${user.username} is already in game ${existingGameId}, reconnecting...`)

      // Reconnect to existing game
      const isPlayer1 = existingGame.player1.user.userId === user.userId
      const playerData = isPlayer1 ? existingGame.player1 : existingGame.player2
      const opponentData = isPlayer1 ? existingGame.player2 : existingGame.player1

      // Update socket ID
      if (isPlayer1) {
        existingGame.player1.socketId = socket.id
      } else {
        existingGame.player2.socketId = socket.id
      }

      socket.data = { gameId: existingGameId }

      // Send game state to reconnected player
      socket.emit("color", isPlayer1 ? "white" : "black")
      socket.emit("opponent", opponentData.user)
      socket.emit("waiting", false)
      socket.emit("gameAssigned", existingGameId)

      // Send current game state (FEN)
      if (existingGame.currentFen) {
        socket.emit("gameState", existingGame.currentFen)
      }

      // Notify opponent of reconnection
      io.to(opponentData.socketId).emit("opponentReconnected", user.username)

      return
    }

    // Add to waiting players if not already in a game
    const existingPlayerIndex = waitingPlayers.findIndex((p) => p.user.userId === user.userId)
    if (existingPlayerIndex !== -1) {
      console.log(`Updating socket ID for waiting player ${user.username}`)
      waitingPlayers[existingPlayerIndex].socketId = socket.id
    } else {
      waitingPlayers.push({
        socketId: socket.id,
        user: user,
        joinedAt: Date.now(),
      })
    }

    console.log(`Waiting players: ${waitingPlayers.length}`)
    logServerState()

    // Send waiting status to the client
    socket.emit("waiting", true)
    socket.emit("waitingCount", waitingPlayers.length)

    // Broadcast waiting count to all waiting players
    waitingPlayers.forEach((player) => {
      io.to(player.socketId).emit("waitingCount", waitingPlayers.length)
    })

    // Check if we have enough players to start a game
    if (waitingPlayers.length >= 2) {
      // Sort by join time to match players who have been waiting longest
      waitingPlayers.sort((a, b) => a.joinedAt - b.joinedAt)

      const player1 = waitingPlayers.shift()
      const player2 = waitingPlayers.shift()

      console.log(`Starting game between ${player1.user.username} and ${player2.user.username}`)

      // Create a game ID
      const gameId = `game_${Date.now()}_${player1.user.userId}_${player2.user.userId}`

      // Initialize a chess game
      const chess = new Chess()

      // Store game info
      activeGames.set(gameId, {
        player1: player1,
        player2: player2,
        moves: [],
        startTime: Date.now(),
        currentFen: chess.fen(),
        chess: chess,
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

      // Send game ID to both players
      io.to(player1.socketId).emit("gameAssigned", gameId)
      io.to(player2.socketId).emit("gameAssigned", gameId)

      // Update waiting status
      io.to(player1.socketId).emit("waiting", false)
      io.to(player2.socketId).emit("waiting", false)

      // Broadcast updated waiting count to remaining players
      waitingPlayers.forEach((player) => {
        io.to(player.socketId).emit("waitingCount", waitingPlayers.length)
      })

      logServerState()
    }

    // Handle get waiting count requests
    socket.on("getWaitingCount", () => {
      socket.emit("waitingCount", waitingPlayers.length)
    })

    // Handle moves with improved validation
    socket.on("move", (moveData) => {
      const gameId = socket.data?.gameId
      if (!gameId) {
        console.error("Move received but player is not in a game")
        socket.emit("error", { message: "You are not in a game" })
        return
      }

      const game = activeGames.get(gameId)
      if (!game) {
        console.error("Game not found:", gameId)
        socket.emit("error", { message: "Game not found" })
        return
      }

      // Validate move data
      if (!moveData || !moveData.from || !moveData.to) {
        console.error("Invalid move data:", moveData)
        socket.emit("error", { message: "Invalid move data" })
        return
      }

      // Update the server-side chess game
      try {
        if (moveData.fen) {
          // If FEN is provided, use it to sync game state
          game.chess.load(moveData.fen)
          game.currentFen = moveData.fen
        } else {
          // Otherwise make the move on the server
          const move = game.chess.move({
            from: moveData.from,
            to: moveData.to,
            promotion: moveData.obtainedPromotion || "q",
          })

          if (move) {
            game.currentFen = game.chess.fen()
            moveData.fen = game.currentFen // Add FEN to the move data
          } else {
            console.error("Invalid move:", moveData)
            socket.emit("error", { message: "Invalid move" })
            return
          }
        }
      } catch (error) {
        console.error("Error processing move:", error)
        socket.emit("error", { message: "Error processing move" })
        return
      }

      // Store the move
      game.moves.push({
        ...moveData,
        timestamp: Date.now(),
        player: socket.id === game.player1.socketId ? "player1" : "player2",
      })

      // Forward the move to the opponent
      const isPlayer1 = game.player1.socketId === socket.id
      const opponentSocketId = isPlayer1 ? game.player2.socketId : game.player1.socketId

      io.to(opponentSocketId).emit("move", moveData)

      // Check for game over conditions
      if (game.chess.isGameOver()) {
        const result = {
          isCheckmate: game.chess.isCheckmate(),
          isDraw: game.chess.isDraw(),
          winner: game.chess.isCheckmate() ? (game.chess.turn() === "w" ? "black" : "white") : null,
        }

        // Emit game over event to both players
        io.to(game.player1.socketId).emit("gameOver", result)
        io.to(game.player2.socketId).emit("gameOver", result)

        // Keep the game active for a short period for viewing the final position
        setTimeout(() => {
          activeGames.delete(gameId)
          console.log(`Game ${gameId} ended and removed after timeout`)
        }, 60000) // 1 minute timeout
      }
    })

    // Handle request for current game state
    socket.on("requestGameState", () => {
      const gameId = socket.data?.gameId
      if (!gameId) {
        console.error("Game state requested but player is not in a game")
        socket.emit("error", { message: "You are not in a game" })
        return
      }

      const game = activeGames.get(gameId)
      if (!game) {
        console.error("Game not found:", gameId)
        socket.emit("error", { message: "Game not found" })
        return
      }

      // Send current FEN to the requesting client
      socket.emit("gameState", game.currentFen)
    })

    // Handle match completed event
    socket.on("matchCompleted", (result) => {
      console.log("Match completed:", result)
      const gameId = socket.data?.gameId

      if (gameId && activeGames.has(gameId)) {
        console.log(`Removing completed game ${gameId}`)
        activeGames.delete(gameId)
      }
    })

    // Handle player left event
    socket.on("playerLeft", (data) => {
      console.log("Player left:", data)

      if (data.opponentId) {
        // Find the opponent's socket
        const opponentSocket = Array.from(io.sockets.sockets.values()).find(
          (s) => s.handshake.query.user && JSON.parse(s.handshake.query.user).userId === data.opponentId,
        )

        if (opponentSocket) {
          opponentSocket.emit("opponentDisconnected", data.username)
        }
      }

      // Remove the game if it exists
      const gameId = socket.data?.gameId
      if (gameId && activeGames.has(gameId)) {
        console.log(`Removing game ${gameId} due to player leaving`)
        activeGames.delete(gameId)
      }
    })

    // Handle disconnection
    socket.on("disconnect", () => {
      console.log(`User disconnected: ${socket.id}`)

      // Remove from waiting players
      waitingPlayers = waitingPlayers.filter((p) => p.socketId !== socket.id)

      // Update waiting count for remaining players
      waitingPlayers.forEach((player) => {
        io.to(player.socketId).emit("waitingCount", waitingPlayers.length)
      })

      // Check if player is in a game
      const gameId = socket.data?.gameId
      if (gameId) {
        const game = activeGames.get(gameId)
        if (game) {
          // Notify opponent
          const isPlayer1 = game.player1.socketId === socket.id
          const opponentSocketId = isPlayer1 ? game.player2.socketId : game.player1.socketId
          const disconnectedUser = isPlayer1 ? game.player1.user : game.player2.user

          console.log(`Player ${disconnectedUser.username} disconnected from game ${gameId}`)

          // Keep the game active for a short period to allow reconnection
          setTimeout(() => {
            const updatedGame = activeGames.get(gameId)
            if (updatedGame) {
              // Check if the player has reconnected
              const currentSocketId = isPlayer1 ? updatedGame.player1.socketId : updatedGame.player2.socketId
              if (currentSocketId === socket.id) {
                console.log(`Player ${disconnectedUser.username} did not reconnect, ending game ${gameId}`)
                io.to(opponentSocketId).emit("opponentDisconnected", disconnectedUser.username)
                activeGames.delete(gameId)
              }
            }
          }, 30000) // 30 second grace period for reconnection
        }
      }

      logServerState()
    })
  } catch (error) {
    console.error("Error in socket connection:", error)
    socket.emit("error", { message: "Server error" })
  }
})

// Clean up stale games periodically
setInterval(
  () => {
    const now = Date.now()
    for (const [gameId, game] of activeGames.entries()) {
      // Remove games older than 3 hours
      if (now - game.startTime > 3 * 60 * 60 * 1000) {
        console.log(`Removing stale game ${gameId}`)
        activeGames.delete(gameId)
      }
    }
  },
  15 * 60 * 1000,
) // Check every 15 minutes

httpServer.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)
})

