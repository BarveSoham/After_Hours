import express from 'express';
import http from 'http';
import { Server } from 'socket.io';

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const REQUIRED_PLAYERS = 3;
let gameState = 'waiting'; // 'waiting', 'in_progress', 'ended'
let players = {};

let keycard = {
  x: 550,
  y: 480,
  collected: false,
  carriedBy: null
};

let exitGate = {
  x: 740,
  y: 80,
  unlocked: false
};

function startMatch() {
  gameState = 'in_progress';
  keycard = { x: 550, y: 480, collected: false, carriedBy: null };
  exitGate.unlocked = false;

  const playerIds = Object.keys(players);
  // Pick ONE random player to be the Hunter
  const hunterIndex = Math.floor(Math.random() * playerIds.length);
  const hunterId = playerIds[hunterIndex];

  playerIds.forEach((id) => {
    const isHunter = (id === hunterId);
    players[id].role = isHunter ? 'hunter' : 'survivor';
    players[id].alive = true;
    // Hunter spawns top-left, survivors spawn bottom/middle
    players[id].x = isHunter ? 120 : Math.floor(Math.random() * 200) + 300;
    players[id].y = isHunter ? 120 : Math.floor(Math.random() * 200) + 300;
  });

  io.emit('matchStarted', {
    players,
    keycard,
    exitGate
  });
  console.log(`[!] Match started with 3 players! Hunter is: ${hunterId}`);
}

io.on('connection', (socket) => {
  console.log(`[+] Player joined: ${socket.id}`);

  // Listen for replay / restart request
  socket.on('requestRestart', () => {
    // Only restart if match is actually finished
    if (gameState === 'ended') {
      console.log(`[!] Replay initiated by ${socket.id}`);
      startMatch();
    }
  });

  // Default player setup in waiting lobby
  players[socket.id] = {
    id: socket.id,
    x: 400,
    y: 300,
    angle: 0,
    role: 'waiting',
    alive: true
  };

  // Send current lobby status to everyone
  const currentCount = Object.keys(players).length;
  io.emit('lobbyUpdate', {
    count: currentCount,
    required: REQUIRED_PLAYERS,
    gameState: gameState
  });

  // Start match automatically when 3 players have gathered
  if (currentCount === REQUIRED_PLAYERS && gameState === 'waiting') {
    startMatch();
  }

  // Position updates
  socket.on('playerMovement', (movementData) => {
    if (players[socket.id] && gameState === 'in_progress') {
      players[socket.id].x = movementData.x;
      players[socket.id].y = movementData.y;
      players[socket.id].angle = movementData.angle;
      socket.broadcast.emit('playerMoved', players[socket.id]);
    }
  });

  // Pickup Keycard
  socket.on('pickupItem', () => {
    const p = players[socket.id];
    if (!p || p.role !== 'survivor' || keycard.collected || gameState !== 'in_progress') return;

    const dist = Math.hypot(p.x - keycard.x, p.y - keycard.y);
    if (dist < 60) {
      keycard.collected = true;
      keycard.carriedBy = socket.id;
      exitGate.unlocked = true;
      io.emit('itemCollected', { collectorId: socket.id });
    }
  });

  // Survivor escape
  socket.on('playerEscaped', () => {
    if (gameState !== 'in_progress' || !exitGate.unlocked) return;
    gameState = 'ended';
    io.emit('gameOver', { winner: 'survivor', message: 'SURVIVORS ESCAPED!' });
  });

  // Hunter attack
  socket.on('hunterAttack', () => {
    const hunter = players[socket.id];
    if (!hunter || hunter.role !== 'hunter' || gameState !== 'in_progress') return;

    Object.values(players).forEach((target) => {
      if (target.role === 'survivor' && target.alive) {
        const dist = Math.hypot(hunter.x - target.x, hunter.y - target.y);
        if (dist < 65) {
          gameState = 'ended';
          io.emit('gameOver', { winner: 'hunter', message: 'THE HUNTER WINS!' });
        }
      }
    });
  });

  // Handle player leaving
  socket.on('disconnect', () => {
    console.log(`[-] Player left: ${socket.id}`);
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);

    const remaining = Object.keys(players).length;
    if (remaining < REQUIRED_PLAYERS) {
      gameState = 'waiting';
      io.emit('lobbyUpdate', {
        count: remaining,
        required: REQUIRED_PLAYERS,
        gameState: gameState
      });
    }
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`After Hours game server listening on http://localhost:${PORT}`);
});