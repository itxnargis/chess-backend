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

const corsOptions = {
  origin:
    process.env.NODE_ENV === "production"
      ? true // Allow requests from any origin in production
      : "https://chess-frontend-dun.vercel.app/", // Restrict in development
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
const playerGameMap = new Map() // Map to track which game a player is in
const playerTimeouts = new Map() // Map to track player inactivity timeouts

const logServerState = () => {
  console.log(`[SERVER STATE] Waiting players: ${waitingPlayers.length}, Active games: ${activeGames.size}`)
  if (waitingPlayers.length > 0) {
    console.log(
      `[WAITING PLAYERS] ${JSON.stringify(waitingPlayers.map((p) => ({ id: p.socketId, username: p.user.username })))}`,
    )
  }
}

// Clean up stale games and waiting players
const cleanupStaleEntities = () => {
  const now = Date.now()

  // Clean up stale games
  for (const [gameId, game] of activeGames.entries()) {
    // Remove games older than 3 hours
    if (now - game.startTime > 3 * 60 * 60 * 1000) {
      console.log(`Removing stale game ${gameId}`)

      // Notify players if they're still connected
      if (io.sockets.sockets.has(game.player1.socketId)) {
        io.to(game.player1.socketId).emit("gameExpired")
      }

      if (io.sockets.sockets.has(game.player2.socketId)) {
        io.to(game.player2.socketId).emit("gameExpired")
      }

      // Remove from player game map
      if (game.player1.user.userId) {
        playerGameMap.delete(game.player1.user.userId)
      }

      if (game.player2.user.userId) {
        playerGameMap.delete(game.player2.user.userId)
      }

      activeGames.delete(gameId)
    }
  }

  // Clean up stale waiting players (waiting for more than 30 minutes)
  waitingPlayers = waitingPlayers.filter((player) => {
    const isStale = now - player.joinedAt > 30 * 60 * 1000
    if (isStale) {
      console.log(`Removing stale waiting player: ${player.user.username}`)
      if (io.sockets.sockets.has(player.socketId)) {
        io.to(player.socketId).emit("waitingExpired")
      }
    }
    return !isStale
  })
}

// Run cleanup every 15 minutes
setInterval(cleanupStaleEntities, 15 * 60 * 1000)

// Log server state every minute
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

    // Check if user is already in a game (reconnection)
    let existingGame = null
    let existingGameId = null

    // First check if the user provided a lastGameId
    if (lastGameId && activeGames.has(lastGameId)) {
      existingGame = activeGames.get(lastGameId)
      existingGameId = lastGameId

      // Verify the user is actually part of this game
      if (existingGame.player1.user.userId !== user.userId && existingGame.player2.user.userId !== user.userId) {
        existingGame = null
        existingGameId = null
      }
    }

    // If no game found by ID, check if user is in any active game
    if (!existingGame) {
      // Check the player-game map first (more efficient)
      if (playerGameMap.has(user.userId)) {
        existingGameId = playerGameMap.get(user.userId)
        if (activeGames.has(existingGameId)) {
          existingGame = activeGames.get(existingGameId)
        }
      }

      // Fallback: search all games (less efficient)
      if (!existingGame) {
        for (const [gameId, game] of activeGames.entries()) {
          if (game.player1.user.userId === user.userId || game.player2.user.userId === user.userId) {
            existingGame = game
            existingGameId = gameId
            // Update the player-game map
            playerGameMap.set(user.userId, gameId)
            break
          }
        }
      }
    }

    // Handle reconnection to existing game
    if (existingGame) {
      console.log(`User ${user.username} is already in game ${existingGameId}, reconnecting...`)

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

      // Make sure to send the current game state
      if (existingGame.currentFen) {
        // Send immediately and then again after a short delay to ensure it's received
        socket.emit("gameState", existingGame.currentFen)
        setTimeout(() => {
          socket.emit("gameState", existingGame.currentFen)
        }, 1000)
      }

      // Notify opponent of reconnection
      io.to(opponentData.socketId).emit("opponentReconnected", user.username)

      // Clear any inactivity timeout for this player
      if (playerTimeouts.has(user.userId)) {
        clearTimeout(playerTimeouts.get(user.userId))
        playerTimeouts.delete(user.userId)
      }

      return
    }

    // Remove user from any existing waiting queue entries
    waitingPlayers = waitingPlayers.filter((p) => p.user.userId !== user.userId)

    // Add to waiting queue
    waitingPlayers.push({
      socketId: socket.id,
      user: user,
      joinedAt: Date.now(),
    })

    console.log(`Waiting players: ${waitingPlayers.length}`)
    logServerState()

    socket.emit("waiting", true)
    socket.emit("waitingCount", waitingPlayers.length)

    // Update all waiting players with new count
    waitingPlayers.forEach((player) => {
      io.to(player.socketId).emit("waitingCount", waitingPlayers.length)
    })

    // Match players if we have enough
    if (waitingPlayers.length >= 2) {
      // Sort by join time to ensure fairness
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
        lastMoveTime: Date.now(),
        currentFen: chess.fen(),
        chess: chess,
      })

      // Update player-game map
      playerGameMap.set(player1.user.userId, gameId)
      playerGameMap.set(player2.user.userId, gameId)

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

      // Update remaining waiting players with new count
      waitingPlayers.forEach((player) => {
        io.to(player.socketId).emit("waitingCount", waitingPlayers.length)
      })

      logServerState()
    }

    // Handle waiting count requests
    socket.on("getWaitingCount", () => {
      socket.emit("waitingCount", waitingPlayers.length)
    })

    // Handle move events
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
        // Always update the chess instance with the move
        if (moveData.fen) {
          // If FEN is provided, use it to sync game state
          game.chess.load(moveData.fen)
          game.currentFen = moveData.fen
          console.log("Game state updated with FEN:", moveData.fen)
        } else {
          // Otherwise make the move normally
          const move = game.chess.move({
            from: moveData.from,
            to: moveData.to,
            promotion: moveData.obtainedPromotion || "q",
          })

          if (move) {
            game.currentFen = game.chess.fen()
            moveData.fen = game.currentFen // Add FEN to moveData for the opponent
            console.log("Move made, updated FEN:", game.currentFen)
          } else {
            console.error("Invalid move:", moveData)
            socket.emit("error", { message: "Invalid move" })
            return
          }
        }

        // Update last move time
        game.lastMoveTime = Date.now()

        // Add move to game history
        game.moves.push({
          ...moveData,
          timestamp: Date.now(),
          player: socket.id === game.player1.socketId ? "player1" : "player2",
        })

        // Determine which player made the move and send to opponent
        const isPlayer1 = game.player1.socketId === socket.id
        const opponentSocketId = isPlayer1 ? game.player2.socketId : game.player1.socketId

        // Make sure the FEN is included in the move data sent to the opponent
        if (!moveData.fen) {
          moveData.fen = game.currentFen
        }

        // Send move to opponent with FEN for state synchronization
        console.log(`Sending move to opponent (${opponentSocketId}):`, moveData)
        io.to(opponentSocketId).emit("move", moveData)

        // Also send the current game state to ensure both players are in sync
        setTimeout(() => {
          io.to(opponentSocketId).emit("gameState", game.currentFen)
        }, 500)

        // Check if game is over
        if (game.chess.isGameOver()) {
          const result = {
            isCheckmate: game.chess.isCheckmate(),
            isDraw: game.chess.isDraw(),
            winner: game.chess.isCheckmate() ? (game.chess.turn() === "w" ? "black" : "white") : null,
          }

          io.to(game.player1.socketId).emit("gameOver", result)
          io.to(game.player2.socketId).emit("gameOver", result)

          // Clean up game after a delay
          setTimeout(() => {
            if (activeGames.has(gameId)) {
              // Remove from player game map
              if (game.player1.user.userId) {
                playerGameMap.delete(game.player1.user.userId)
              }

              if (game.player2.user.userId) {
                playerGameMap.delete(game.player2.user.userId)
              }

              activeGames.delete(gameId)
              console.log(`Game ${gameId} ended and removed after timeout`)
            }
          }, 60000)
        }
      } catch (error) {
        console.error("Error processing move:", error)
        socket.emit("error", { message: "Error processing move" })
      }
    })

    // Handle game state requests
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

    // Handle match completion
    socket.on("matchCompleted", (result) => {
      console.log("Match completed:", result)
      const gameId = socket.data?.gameId

      if (gameId && activeGames.has(gameId)) {
        const game = activeGames.get(gameId)

        // Remove from player game map
        if (game.player1.user.userId) {
          playerGameMap.delete(game.player1.user.userId)
        }

        if (game.player2.user.userId) {
          playerGameMap.delete(game.player2.user.userId)
        }

        console.log(`Removing completed game ${gameId}`)
        activeGames.delete(gameId)
      }
    })

    // Handle player leaving
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
        const game = activeGames.get(gameId)

        // Remove from player game map
        if (game.player1.user.userId) {
          playerGameMap.delete(game.player1.user.userId)
        }

        if (game.player2.user.userId) {
          playerGameMap.delete(game.player2.user.userId)
        }

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

      // Handle game disconnection
      const gameId = socket.data?.gameId
      if (gameId) {
        const game = activeGames.get(gameId)
        if (game) {
          const isPlayer1 = game.player1.socketId === socket.id
          const opponentSocketId = isPlayer1 ? game.player2.socketId : game.player1.socketId
          const disconnectedUser = isPlayer1 ? game.player1.user : game.player2.user

          console.log(`Player ${disconnectedUser.username} disconnected from game ${gameId}`)

          // Set a timeout to handle if player doesn't reconnect
          const timeoutId = setTimeout(() => {
            const updatedGame = activeGames.get(gameId)
            if (updatedGame) {
              const currentSocketId = isPlayer1 ? updatedGame.player1.socketId : updatedGame.player2.socketId
              if (currentSocketId === socket.id) {
                console.log(
                  `Player ${disconnectedUser.username} did not reconnect within timeout, ending game ${gameId}`,
                )
                io.to(opponentSocketId).emit("opponentDisconnected", disconnectedUser.username)

                // Remove from player game map
                if (updatedGame.player1.user.userId) {
                  playerGameMap.delete(updatedGame.player1.user.userId)
                }

                if (updatedGame.player2.user.userId) {
                  playerGameMap.delete(updatedGame.player2.user.userId)
                }

                activeGames.delete(gameId)
              }
            }

            // Remove the timeout from the map
            if (disconnectedUser.userId) {
              playerTimeouts.delete(disconnectedUser.userId)
            }
          }, 15000) // 15 seconds timeout as requested

          // Store the timeout
          if (disconnectedUser.userId) {
            playerTimeouts.set(disconnectedUser.userId, timeoutId)
          }
        }
      }

      logServerState()
    })
  } catch (error) {
    console.error("Error in socket connection:", error)
    socket.emit("error", { message: "Server error" })
  }
})

httpServer.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)
})
