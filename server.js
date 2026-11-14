import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Initialize 'app' FIRST
const app = express();
const server = http.createServer(app);

// 2. Use 'app' SECOND (must be below const app = express())
app.use(express.static(path.join(__dirname, 'dist')));

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const REQUIRED_PLAYERS = 3;

// rooms[roomCode] = { gameState, players: {}, survivorTasks: {}, hunterSocketId, hostId, activeChannels: {} }
const rooms = {};

// East Exit Chamber is from x: 1400..1990 and y: 450..1050
const exitGate = {
  x: 1840,
  y: 750,
  w: 60,
  h: 120
};

// Distinct spawns in the surrounding outer rooms
const SURVIVOR_SPAWNS = [
  { x: 300, y: 250 },   // North-West Room
  { x: 300, y: 1250 }   // South-West Room
];

// Terminals inside distinct outer rooms
const TASK_LOCATIONS = [
  { x: 1000, y: 240 },  // North Lab
  { x: 1000, y: 1260 }, // South Storage
  { x: 1700, y: 240 }   // North-East Room
];
const CHANNEL_DURATION_MS = 1200;
const ATTACK_COOLDOWN_MS = 1200;

function startMatch(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  const playerIds = Object.keys(room.players);
  if (playerIds.length < 2) return; // Allow 2-3+ players to test freely

  room.gameState = 'in_progress';
  room.survivorTasks = {};
  room.activeChannels = {};

  const hunterIndex = Math.floor(Math.random() * playerIds.length);
  room.hunterSocketId = playerIds[hunterIndex];

  let survivorCount = 0;

  playerIds.forEach((id) => {
    const isHunter = (id === room.hunterSocketId);
    room.players[id].role = isHunter ? 'hunter' : 'survivor';
    room.players[id].alive = true;
    room.players[id].escaped = false;
    room.players[id].taskCompleted = false;
    room.players[id].lastAttackTime = 0;

    if (isHunter) {
      room.players[id].x = 1000;
      room.players[id].y = 750;
    } else {
      const spawn = SURVIVOR_SPAWNS[survivorCount % SURVIVOR_SPAWNS.length];
      room.players[id].x = spawn.x;
      room.players[id].y = spawn.y;

      const loc = TASK_LOCATIONS[survivorCount % TASK_LOCATIONS.length];
      room.survivorTasks[id] = {
        x: loc.x,
        y: loc.y,
        completed: false
      };
      survivorCount++;
    }
  });

  io.to(roomCode).emit('matchStarted', {
    players: room.players,
    survivorTasks: room.survivorTasks,
    exitGate
  });
  console.log(`[!] Match started in [${roomCode}] with ${playerIds.length} players. Hunter: ${room.hunterSocketId}`);
}

function checkMatchEndCondition(roomCode) {
  const room = rooms[roomCode];
  if (!room || room.gameState !== 'in_progress') return;

  const survivors = Object.values(room.players).filter(p => p.role === 'survivor');
  if (survivors.length === 0) return;

  const allDone = survivors.every(s => !s.alive || s.escaped);

  if (allDone) {
    room.gameState = 'ended';
    const escapedCount = survivors.filter(s => s.escaped).length;

    if (escapedCount === 0) {
      io.to(roomCode).emit('gameOver', {
        winner: 'hunter',
        message: 'MATCH OVER\nAll wanderers perished in the woods!'
      });
    } else {
      io.to(roomCode).emit('gameOver', {
        winner: 'survivor',
        message: 'MATCH OVER\nSurvivors Escaped The Night!'
      });
    }
  }
}

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('joinRoom', ({ name, roomCode }) => {
    currentRoom = (roomCode || 'WOODS-1').toUpperCase().trim();
    socket.join(currentRoom);

    if (!rooms[currentRoom]) {
      rooms[currentRoom] = {
        gameState: 'waiting',
        hostId: socket.id,
        players: {},
        survivorTasks: {},
        hunterSocketId: null,
        activeChannels: {},
        lastFootprintTime: {}
      };
    }

    const room = rooms[currentRoom];
    room.players[socket.id] = {
      id: socket.id,
      name: name || 'Lost_Seeker',
      x: 1000,
      y: 750,
      angle: 0,
      role: 'waiting',
      alive: true,
      escaped: false,
      ready: true,
      taskCompleted: false,
      lastAttackTime: 0
    };

    console.log(`[+] ${name} (${socket.id}) joined [${currentRoom}]`);

    // Broadcast room roster
    io.to(currentRoom).emit('lobbyRosterUpdate', {
      roomCode: currentRoom,
      hostId: room.hostId,
      players: Object.values(room.players),
      gameState: room.gameState
    });
  });

  socket.on('toggleReady', () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const p = rooms[currentRoom].players[socket.id];
    if (p) {
      p.ready = !p.ready;
      io.to(currentRoom).emit('lobbyRosterUpdate', {
        roomCode: currentRoom,
        hostId: rooms[currentRoom].hostId,
        players: Object.values(rooms[currentRoom].players),
        gameState: rooms[currentRoom].gameState
      });
    }
  });

  socket.on('startMatchRequest', () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    startMatch(currentRoom);
  });

  socket.on('playerMovement', (movementData) => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    const p = room.players[socket.id];

    if (p && room.gameState === 'in_progress' && p.alive && !p.escaped) {
      p.x = movementData.x;
      p.y = movementData.y;
      p.angle = movementData.angle;
      socket.to(currentRoom).emit('playerMoved', p);

      if (p.role === 'survivor' && movementData.isSprinting && room.hunterSocketId) {
        const now = Date.now();
        const lastTime = room.lastFootprintTime[socket.id] || 0;
        if (now - lastTime > 220) {
          room.lastFootprintTime[socket.id] = now;
          io.to(room.hunterSocketId).emit('spawnFootprint', {
            x: p.x,
            y: p.y,
            angle: p.angle
          });
        }
      }
    }
  });

  socket.on('startChanneling', () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    const p = room.players[socket.id];
    const task = room.survivorTasks[socket.id];

    if (!p || p.role !== 'survivor' || !p.alive || p.taskCompleted || !task || room.gameState !== 'in_progress') return;

    const dist = Math.hypot(p.x - task.x, p.y - task.y);
    if (dist < 85) {
      room.activeChannels[socket.id] = Date.now();
      socket.emit('channelAccepted', { durationMs: 1250 }); // Changed from 2500
    }
  });

  socket.on('cancelChanneling', () => {
    if (currentRoom && rooms[currentRoom]) {
      delete rooms[currentRoom].activeChannels[socket.id];
    }
  });

  socket.on('finishChanneling', () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    const p = room.players[socket.id];
    const task = room.survivorTasks[socket.id];
    const startTime = room.activeChannels[socket.id];

    if (!p || p.role !== 'survivor' || !p.alive || p.taskCompleted || !task || room.gameState !== 'in_progress' || !startTime) {
      if (room.activeChannels) delete room.activeChannels[socket.id];
      return;
    }

    const elapsed = Date.now() - startTime;
    const dist = Math.hypot(p.x - task.x, p.y - task.y);

    if (elapsed >= CHANNEL_DURATION_MS && dist < 95) {
      p.taskCompleted = true;
      task.completed = true;
      delete room.activeChannels[socket.id];
      socket.emit('personalTaskDone');
    } else {
      delete room.activeChannels[socket.id];
    }
  });

  socket.on('playerEscaped', () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    const p = room.players[socket.id];

    if (!p || p.role !== 'survivor' || !p.alive || !p.taskCompleted || p.escaped || room.gameState !== 'in_progress') return;

    const dist = Math.hypot(p.x - exitGate.x, p.y - exitGate.y);
    if (dist < 90) {
      p.escaped = true;
      socket.emit('youEscaped');
      socket.to(currentRoom).emit('survivorEscapedNotification', { id: socket.id });
      checkMatchEndCondition(currentRoom);
    }
  });

  socket.on('hunterAttack', () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    const hunter = room.players[socket.id];

    if (!hunter || hunter.role !== 'hunter' || room.gameState !== 'in_progress') return;

    const now = Date.now();
    if (now - hunter.lastAttackTime < ATTACK_COOLDOWN_MS) return;
    hunter.lastAttackTime = now;

    socket.emit('attackExecuted', { cooldownMs: ATTACK_COOLDOWN_MS });

    let hitOccurred = false;
    Object.values(room.players).forEach((target) => {
      if (target.role === 'survivor' && target.alive && !target.escaped) {
        const dist = Math.hypot(hunter.x - target.x, hunter.y - target.y);
        if (dist <= 105) {
          target.alive = false;
          hitOccurred = true;
          if (room.activeChannels) delete room.activeChannels[target.id];
          io.to(currentRoom).emit('survivorEliminated', { victimId: target.id });
          checkMatchEndCondition(currentRoom);
        }
      }
    });

    if (hitOccurred) {
      io.to(currentRoom).emit('hunterHitEffect');
    }
  });

  socket.on('requestRestart', () => {
    if (currentRoom && rooms[currentRoom]) {
      startMatch(currentRoom);
    }
  });

  socket.on('disconnect', () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];

    delete room.players[socket.id];
    delete room.survivorTasks[socket.id];
    if (room.activeChannels) delete room.activeChannels[socket.id];

    if (socket.id === room.hunterSocketId) {
      room.hunterSocketId = null;
    }

    if (socket.id === room.hostId) {
      const remainingIds = Object.keys(room.players);
      room.hostId = remainingIds.length > 0 ? remainingIds[0] : null;
    }

    io.to(currentRoom).emit('playerDisconnected', socket.id);

    const remaining = Object.keys(room.players).length;
    if (remaining === 0) {
      delete rooms[currentRoom];
    } else {
      io.to(currentRoom).emit('lobbyRosterUpdate', {
        roomCode: currentRoom,
        hostId: room.hostId,
        players: Object.values(room.players),
        gameState: room.gameState
      });

      if (room.gameState === 'in_progress') {
        checkMatchEndCondition(currentRoom);
      }
    }
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`After Hours game server listening on http://localhost:${PORT}`);
});