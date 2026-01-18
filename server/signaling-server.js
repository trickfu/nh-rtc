const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*", // In production, replace with your actual domain
    methods: ["GET", "POST"],
  },
});

const rooms = {};

// Health check endpoint for Render
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join", ({ username, room }) => {
    socket.join(room);
    socket.username = username;
    socket.room = room;

    if (!rooms[room]) {
      rooms[room] = [];
    }
    rooms[room].push(socket.id);

    console.log(`${username} joined room: ${room}`);

    // If there are 2 users in the room, tell the second user to send an offer
    // and notify the first user that someone joined (so they're ready to receive)
    if (rooms[room].length === 2) {
      // Notify first user that a peer is joining
      socket.to(room).emit("peer-joined");
      // Tell second user to initiate the offer
      socket.emit("ready");
    }
  });

  socket.on("data", ({ username, room, data }) => {
    // Send data to everyone else in the room
    socket.to(room).emit("data", data);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    if (socket.room && rooms[socket.room]) {
      rooms[socket.room] = rooms[socket.room].filter((id) => id !== socket.id);
      if (rooms[socket.room].length === 0) {
        delete rooms[socket.room];
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Signaling server running on http://localhost:${PORT}`);
});
