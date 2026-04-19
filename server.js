const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// name -> { socketId, status: 'free'|'busy', friends: Set<name>, pendingIn: Set<name> }
const users = new Map();
// socketId -> name
const socketToName = new Map();

function socketOf(name) {
  const u = users.get(name);
  return u ? io.sockets.sockets.get(u.socketId) : null;
}

function sendFriendsUpdate(name) {
  const u = users.get(name);
  if (!u) return;
  const list = Array.from(u.friends).map(fn => {
    const f = users.get(fn);
    return { name: fn, status: f ? f.status : 'offline', online: !!f };
  });
  const sock = socketOf(name);
  if (sock) sock.emit('friends_update', list);
}

function sendPendingUpdate(name) {
  const u = users.get(name);
  if (!u) return;
  const sock = socketOf(name);
  if (sock) sock.emit('pending_update', Array.from(u.pendingIn));
}

io.on('connection', (socket) => {
  socket.on('join', (name) => {
    const n = String(name).trim().slice(0, 20);
    if (!n) return socket.emit('join_error', 'ニックネームを入力してください');
    if (users.has(n)) return socket.emit('join_error', 'この名前は使われています');

    users.set(n, { socketId: socket.id, status: 'busy', friends: new Set(), pendingIn: new Set() });
    socketToName.set(socket.id, n);

    socket.emit('join_ok', n);
    sendFriendsUpdate(n);
    sendPendingUpdate(n);
  });

  socket.on('set_status', (status) => {
    const name = socketToName.get(socket.id);
    if (!name) return;
    const u = users.get(name);
    if (!u || (status !== 'free' && status !== 'busy')) return;
    const prev = u.status;
    u.status = status;

    // notify each friend
    for (const fn of u.friends) {
      sendFriendsUpdate(fn);
      if (status === 'free' && prev !== 'free') {
        const fs = socketOf(fn);
        if (fs) fs.emit('notify', { name });
      }
    }
    // update own friends list (status reflected for others viewing self)
    sendFriendsUpdate(name);
  });

  socket.on('search_user', (target) => {
    const name = socketToName.get(socket.id);
    if (!name) return;
    const t = String(target).trim();
    if (t === name) return socket.emit('search_result', { error: '自分は追加できません' });
    const u = users.get(name);
    if (!t || !users.has(t)) return socket.emit('search_result', { error: 'ユーザーが見つかりません' });
    if (u.friends.has(t)) return socket.emit('search_result', { error: 'すでにフレンドです' });
    const tu = users.get(t);
    if (tu.pendingIn.has(name)) return socket.emit('search_result', { error: 'すでにリクエスト済みです' });
    socket.emit('search_result', { found: t });
  });

  socket.on('send_friend_request', (toName) => {
    const from = socketToName.get(socket.id);
    if (!from) return;
    const tu = users.get(String(toName).trim());
    if (!tu) return;
    const fu = users.get(from);
    if (fu.friends.has(toName) || tu.pendingIn.has(from)) return;
    tu.pendingIn.add(from);
    sendPendingUpdate(toName);
    socket.emit('request_sent', toName);
  });

  socket.on('accept_friend', (fromName) => {
    const name = socketToName.get(socket.id);
    if (!name) return;
    const u = users.get(name);
    const fu = users.get(String(fromName));
    if (!u || !fu || !u.pendingIn.has(fromName)) return;
    u.pendingIn.delete(fromName);
    u.friends.add(fromName);
    fu.friends.add(name);
    sendFriendsUpdate(name);
    sendFriendsUpdate(fromName);
    sendPendingUpdate(name);
    const fs = socketOf(fromName);
    if (fs) fs.emit('friend_accepted', name);
  });

  socket.on('reject_friend', (fromName) => {
    const name = socketToName.get(socket.id);
    if (!name) return;
    const u = users.get(name);
    if (!u) return;
    u.pendingIn.delete(fromName);
    sendPendingUpdate(name);
  });

  socket.on('remove_friend', (targetName) => {
    const name = socketToName.get(socket.id);
    if (!name) return;
    const u = users.get(name);
    const tu = users.get(String(targetName));
    if (!u) return;
    u.friends.delete(targetName);
    if (tu) { tu.friends.delete(name); sendFriendsUpdate(targetName); }
    sendFriendsUpdate(name);
  });

  socket.on('disconnect', () => {
    const name = socketToName.get(socket.id);
    if (!name) return;
    socketToName.delete(socket.id);
    const u = users.get(name);
    users.delete(name);
    if (u) {
      for (const fn of u.friends) sendFriendsUpdate(fn);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
