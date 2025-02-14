### **Backend README (`chess-master-backend`)**


# ♟️ Chess Master (Backend)

This is the **backend repository** for **Chess Master**, a full-featured chess web application.  
It powers the game logic, user authentication, matchmaking, and API services.

## 🌐 API Base URL
🔗 **[https://your-backend-api.render.com](https://your-backend-api.render.com)**

## 📢 Important!
This repository contains only the **backend** code.  
For the frontend UI, visit: **[Chess Master Frontend](https://github.com/itxnargis/chess-frontend)**.

---

## 📜 Table of Contents
- [✨ Features](#-features)
- [🛠 Technologies Used](#-technologies-used)
- [🚀 Setup & Installation](#-setup--installation)
- [🛠 API Endpoints](#-api-endpoints)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

---

## ✨ Features
- 🔐 **User Authentication** (Signup/Login with JWT)
- 🔄 **Real-Time Multiplayer** (WebSockets for global chess matches)
- 🏆 **Game History & Stats Tracking**
- 🧩 **Daily Chess Puzzles API**
- 🔍 **Matchmaking System**
- 📜 **Move Validation & Chess Engine Support**
- 📊 **Leaderboards & Player Ratings**

---

## 🛠 Technologies Used
- **Backend Framework**: Node.js + Express.js
- **Database**: MongoDB + Mongoose
- **Real-Time Multiplayer**: Socket.io
- **Chess Logic**: chess.js + Stockfish AI
- **Authentication**: JWT (JSON Web Tokens)
- **API Testing**: Postman

---

## 🚀 Setup & Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/chess-master-backend.git
   cd chess-master-backend
   
2. **Install Dependencies**
    ```bash
    npm install

3. **Configure environment**
    ```bash
    PORT=5000
    MONGO_URI=your_mongodb_connection_string
    JWT_SECRET=your_secret_key
    FRONTEND_URL=https://your-frontend-deployed-link.vercel.app

4. **Start the server**
     ```bash
     npm start

5. **Your API will be live at http://localhost:5000.**

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the project.
2. Create your feature branch:
   ```bash
   git checkout -b feature/AmazingFeature
3. Commit your changes:
   ```bash
   git commit -m 'Add some AmazingFeature'
4. Push to the branch:
    ```bash
    git push origin feature/AmazingFeature
5. Open a Pull Request.

## 📄 License

## 📄 License
Distributed under the **MIT License**. See [LICENSE](./LICENSE) for details.
