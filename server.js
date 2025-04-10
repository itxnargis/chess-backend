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
const User = require("./models/userModel")

dbConnector()

const PORT = process.env.PORT || 8080
const app = express()
const httpServer = createServer(app)

const corsOptions = {
  origin:
    process.env.NODE_ENV === "production"
      ? true // Allow requests from any origin in production
      : "https://chess-frontend-dun.vercel.app", // Restrict in development
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization"],
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

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() })
})

app.get("*", (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"))
})

const io = new Server(httpServer, {
  cors: corsOptions,
  pingTimeout: 60000,
  pingInterval: 25000,
})

let waitingPlayers = []
const activeGames = new Map()

const logServerState = () => {
  console.log(`[SERVER STATE] Waiting players: ${waitingPlayers.length}, Active games: ${activeGames.size}`)
  if (waitingPlayers.length > 0) {
    console.log(
      `[WAITING PLAYERS] ${JSON.stringify(waitingPlayers.map((p) => ({ id: p.socketId, username: p.user.username })))}`,
    )
  }
}

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

    let existingGame = null
    let existingGameId = null

    if (lastGameId && activeGames.has(lastGameId)) {
      existingGame = activeGames.get(lastGameId)
      existingGameId = lastGameId

      if (existingGame.player1.user.userId !== user.userId && existingGame.player2.user.userId !== user.userId) {
        existingGame = null
        existingGameId = null
      }
    }

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

      const isPlayer1 = existingGame.player1.user.userId === user.userId
      const playerData = isPlayer1 ? existingGame.player1 : existingGame.player2
      const opponentData = isPlayer1 ? existingGame.player2 : existingGame.player1

      if (isPlayer1) {
        existingGame.player1.socketId = socket.id
      } else {
        existingGame.player2.socketId = socket.id
      }

      socket.data = { gameId: existingGameId }

      socket.emit("color", isPlayer1 ? "white" : "black")
      socket.emit("opponent", opponentData.user)
      socket.emit("waiting", false)
      socket.emit("gameAssigned", existingGameId)

      if (existingGame.currentFen) {
        socket.emit("gameState", existingGame.currentFen)
      }

      io.to(opponentData.socketId).emit("opponentReconnected", user.username)

      return
    }

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

    socket.emit("waiting", true)
    socket.emit("waitingCount", waitingPlayers.length)

    waitingPlayers.forEach((player) => {
      io.to(player.socketId).emit("waitingCount", waitingPlayers.length)
    })

    if (waitingPlayers.length >= 2) {
      waitingPlayers.sort((a, b) => a.joinedAt - b.joinedAt)

      const player1 = waitingPlayers.shift()
      const player2 = waitingPlayers.shift()

      console.log(`Starting game between ${player1.user.username} and ${player2.user.username}`)

      const gameId = `game_${Date.now()}_${player1.user.userId}_${player2.user.userId}`

      const chess = new Chess()
      activeGames.set(gameId, {
        player1: player1,
        player2: player2,
        moves: [],
        startTime: Date.now(),
        currentFen: chess.fen(),
        chess: chess,
      })

      const player1Socket = io.sockets.sockets.get(player1.socketId)
      const player2Socket = io.sockets.sockets.get(player2.socketId)

      if (player1Socket) player1Socket.data = { gameId }
      if (player2Socket) player2Socket.data = { gameId }

      io.to(player1.socketId).emit("color", "white")
      io.to(player2.socketId).emit("color", "black")

      io.to(player1.socketId).emit("opponent", player2.user)
      io.to(player2.socketId).emit("opponent", player1.user)

      io.to(player1.socketId).emit("gameAssigned", gameId)
      io.to(player2.socketId).emit("gameAssigned", gameId)

      io.to(player1.socketId).emit("waiting", false)
      io.to(player2.socketId).emit("waiting", false)

      waitingPlayers.forEach((player) => {
        io.to(player.socketId).emit("waitingCount", waitingPlayers.length)
      })

      logServerState()
    }

    socket.on("getWaitingCount", () => {
      socket.emit("waitingCount", waitingPlayers.length)
    })

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

      if (!moveData || !moveData.from || !moveData.to) {
        console.error("Invalid move data:", moveData)
        socket.emit("error", { message: "Invalid move data" })
        return
      }

      try {
        if (moveData.fen) {
          game.chess.load(moveData.fen)
          game.currentFen = moveData.fen
        } else {
          const move = game.chess.move({
            from: moveData.from,
            to: moveData.to,
            promotion: moveData.obtainedPromotion || "q",
          })

          if (move) {
            game.currentFen = game.chess.fen()
            moveData.fen = game.currentFen
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

      game.moves.push({
        ...moveData,
        timestamp: Date.now(),
        player: socket.id === game.player1.socketId ? "player1" : "player2",
      })

      const isPlayer1 = game.player1.socketId === socket.id
      const opponentSocketId = isPlayer1 ? game.player2.socketId : game.player1.socketId

      io.to(opponentSocketId).emit("move", moveData)

      if (game.chess.isGameOver()) {
        const result = {
          isCheckmate: game.chess.isCheckmate(),
          isDraw: game.chess.isDraw(),
          winner: game.chess.isCheckmate() ? (game.chess.turn() === "w" ? "black" : "white") : null,
        }

        io.to(game.player1.socketId).emit("gameOver", result)
        io.to(game.player2.socketId).emit("gameOver", result)

        // Update match history for both players
        updateMatchHistory(game, result)

        setTimeout(() => {
          activeGames.delete(gameId)
          console.log(`Game ${gameId} ended and removed after timeout`)
        }, 60000)
      }
    })

    // Function to update match history for both players
    const updateMatchHistory = async (game, result) => {
      try {
        const player1Id = game.player1.user.userId
        const player2Id = game.player2.user.userId
        const player1Name = game.player1.user.username
        const player2Name = game.player2.user.username

        // Determine match status for each player
        let player1Status, player2Status

        if (result.isDraw) {
          player1Status = "draw"
          player2Status = "draw"
        } else if (result.winner === "white") {
          player1Status = "win"
          player2Status = "lose"
        } else if (result.winner === "black") {
          player1Status = "lose"
          player2Status = "win"
        } else {
          // If no clear winner (e.g., abandoned game), mark as draw
          player1Status = "draw"
          player2Status = "draw"
        }

        // Update player 1's match history
        const player1Response = await axios.post(`${process.env.BASE_URL || ""}/user/${player1Id}/match-history`, {
          opponent: player2Name,
          status: player1Status,
        })

        // Update player 2's match history
        const player2Response = await axios.post(`${process.env.BASE_URL || ""}/user/${player2Id}/match-history`, {
          opponent: player1Name,
          status: player2Status,
        })

        // Notify both players to refresh their profile data
        io.to(game.player1.socketId).emit("matchHistoryUpdated")
        io.to(game.player2.socketId).emit("matchHistoryUpdated")

        console.log(`Match history updated for game between ${player1Name} and ${player2Name}`)
      } catch (error) {
        console.error("Error updating match history:", error)
      }
    }

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

      socket.emit("gameState", game.currentFen)
    })

    socket.on("matchCompleted", (result) => {
      console.log("Match completed:", result)
      const gameId = socket.data?.gameId

      if (gameId && activeGames.has(gameId)) {
        console.log(`Removing completed game ${gameId}`)
        activeGames.delete(gameId)
      }
    })

    socket.on("playerLeft", (data) => {
      console.log("Player left:", data)

      if (data.opponentId) {
        const opponentSocket = Array.from(io.sockets.sockets.values()).find(
          (s) => s.handshake.query.user && JSON.parse(s.handshake.query.user).userId === data.opponentId,
        )

        if (opponentSocket) {
          opponentSocket.emit("opponentDisconnected", data.username)
        }
      }

      const gameId = socket.data?.gameId
      if (gameId && activeGames.has(gameId)) {
        console.log(`Removing game ${gameId} due to player leaving`)
        activeGames.delete(gameId)
      }
    })

    socket.on("disconnect", () => {
      console.log(`User disconnected: ${socket.id}`)

      waitingPlayers = waitingPlayers.filter((p) => p.socketId !== socket.id)

      waitingPlayers.forEach((player) => {
        io.to(player.socketId).emit("waitingCount", waitingPlayers.length)
      })

      const gameId = socket.data?.gameId
      if (gameId) {
        const game = activeGames.get(gameId)
        if (game) {
          const isPlayer1 = game.player1.socketId === socket.id
          const opponentSocketId = isPlayer1 ? game.player2.socketId : game.player1.socketId
          const disconnectedUser = isPlayer1 ? game.player1.user : game.player2.user

          console.log(`Player ${disconnectedUser.username} disconnected from game ${gameId}`)

          setTimeout(() => {
            const updatedGame = activeGames.get(gameId)
            if (updatedGame) {
              const currentSocketId = isPlayer1 ? updatedGame.player1.socketId : updatedGame.player2.socketId
              if (currentSocketId === socket.id) {
                console.log(`Player ${disconnectedUser.username} did not reconnect, ending game ${gameId}`)
                io.to(opponentSocketId).emit("opponentDisconnected", disconnectedUser.username)
                activeGames.delete(gameId)
              }
            }
          }, 30000)
        }
      }

      logServerState()
    })
  } catch (error) {
    console.error("Error in socket connection:", error)
    socket.emit("error", { message: "Server error" })
  }
})

setInterval(
  () => {
    const now = Date.now()
    for (const [gameId, game] of activeGames.entries()) {
      if (now - game.startTime > 3 * 60 * 60 * 1000) {
        console.log(`Removing stale game ${gameId}`)
        activeGames.delete(gameId)
      }
    }
  },
  15 * 60 * 1000,
)

httpServer.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)
})
