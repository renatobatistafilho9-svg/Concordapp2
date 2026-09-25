const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Estado das salas em memória: { roomId: { users: {socketId: {name}}, music: {...} } }
const rooms = {};

function getRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      users: {},
      music: { videoId: null, isPlaying: false, time: 0, updatedAt: Date.now() },
    };
  }
  return rooms[roomId];
}

io.on('connection', (socket) => {
  let currentRoom = null;
  let userName = null;

  socket.on('join-room', ({ roomId, name }) => {
    currentRoom = roomId;
    userName = (name || 'Anônimo').slice(0, 30);
    socket.join(roomId);
    const room = getRoom(roomId);

    // Manda pro recém-chegado a lista de quem já tá na sala, pra ele iniciar as conexões
    const existingUsers = Object.entries(room.users).map(([id, u]) => ({ id, name: u.name }));
    socket.emit('room-users', existingUsers);

    room.users[socket.id] = { name: userName };
    socket.to(roomId).emit('user-joined', { id: socket.id, name: userName });

    // Sincroniza o estado atual da música pra quem acabou de entrar
    socket.emit('music:sync', room.music);
  });

  // Repassa mensagens de sinalização WebRTC (offer/answer/ice candidates) entre pares específicos
  socket.on('signal', ({ to, data }) => {
    io.to(to).emit('signal', { from: socket.id, data });
  });

  // --- Controle de música, sincronizado pra todo mundo na sala ---
  socket.on('music:load', ({ videoId }) => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    room.music = { videoId, isPlaying: true, time: 0, updatedAt: Date.now() };
    io.to(currentRoom).emit('music:sync', room.music);
  });

  socket.on('music:play', ({ time }) => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    room.music.isPlaying = true;
    room.music.time = time;
    room.music.updatedAt = Date.now();
    socket.to(currentRoom).emit('music:sync', room.music);
  });

  socket.on('music:pause', ({ time }) => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    room.music.isPlaying = false;
    room.music.time = time;
    room.music.updatedAt = Date.now();
    socket.to(currentRoom).emit('music:sync', room.music);
  });

  socket.on('music:seek', ({ time }) => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    room.music.time = time;
    room.music.updatedAt = Date.now();
    socket.to(currentRoom).emit('music:sync', room.music);
  });

  socket.on('disconnect', () => {
    if (currentRoom && rooms[currentRoom]) {
      delete rooms[currentRoom].users[socket.id];
      socket.to(currentRoom).emit('user-left', { id: socket.id });
      if (Object.keys(rooms[currentRoom].users).length === 0) {
        delete rooms[currentRoom];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
