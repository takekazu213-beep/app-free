const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// { socketId -> { name, status: 'free' | 'busy' } }
const users = new Map();

function broadcastUsers() {
  const list = Array.from(users.values());
  io.emit('users', list);
}

io.on('connection', (socket) => {
  socket.on('join', (name) => {
    const trimmed = name.trim().slice(0, 20);
    if (!trimmed) return;
    users.set(socket.id, { name: trimmed, status: 'busy' });
    broadcastUsers();
  });

  socket.on('set_status', (status) => {
    const user = users.get(socket.id);
    if (!user) return;
    if (status !== 'free' && status !== 'busy') return;
    const prev = user.status;
    user.status = status;
    if (status === 'free' && prev !== 'free') {
      io.emit('notify', { name: user.name });
    }
    broadcastUsers();
  });

  socket.on('disconnect', () => {
    users.delete(socket.id);
    broadcastUsers();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
