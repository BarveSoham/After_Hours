import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function logToFile(msg) {
  try {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    fs.appendFileSync(path.join(__dirname, 'server.log'), line);
  } catch (_) {}
}

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
  if (playerIds.length < 1) return; // Allow 1 player for solo test, 2+ for multiplayer

  room.gameState = 'in_progress';
  room.survivorTasks = {};
  room.activeChannels = {};
  room.lastFootprintTime = {};

  if (playerIds.length === 1) {
    // Solo playtest mode: player is survivor so they can test mechanics & escape
    room.hunterSocketId = null;
    const id = playerIds[0];
    room.players[id].role = 'survivor';
    room.players[id].alive = true;
    room.players[id].escaped = false;
    room.players[id].taskCompleted = false;
    room.players[id].lastAttackTime = 0;
    room.players[id].x = SURVIVOR_SPAWNS[0].x;
    room.players[id].y = SURVIVOR_SPAWNS[0].y;
    room.survivorTasks[id] = {
      x: TASK_LOCATIONS[0].x,
      y: TASK_LOCATIONS[0].y,
      completed: false
    };
  } else {
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
  }

  io.to(roomCode).emit('matchStarted', {
    players: room.players,
    survivorTasks: room.survivorTasks,
    exitGate
  });
  console.log(`[!] Match started in [${roomCode}] with ${playerIds.length} player(s). Hunter: ${room.hunterSocketId || 'None (Solo Test)'}`);
}

function checkMatchEndCondition(roomCode) {
  try {
    const room = rooms[roomCode];
    if (!room || room.gameState !== 'in_progress' || !room.players) return;

    const survivors = Object.values(room.players).filter(p => p && p.role === 'survivor');
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
      logToFile(`Match ended in [${roomCode}]. Escaped: ${escapedCount}`);
    }
  } catch (err) {
    console.error('[Error in checkMatchEndCondition]', err);
    logToFile(`[Error in checkMatchEndCondition] ${err.message}`);
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
    try {
      if (!movementData || typeof movementData !== 'object') return;
      if (!currentRoom || !rooms[currentRoom]) return;
      const room = rooms[currentRoom];
      const p = room.players ? room.players[socket.id] : null;

      if (p && room.gameState === 'in_progress' && p.alive && !p.escaped) {
        if (typeof movementData.x === 'number') p.x = movementData.x;
        if (typeof movementData.y === 'number') p.y = movementData.y;
        if (typeof movementData.angle === 'number') p.angle = movementData.angle;
        socket.to(currentRoom).emit('playerMoved', p);

        if (p.role === 'survivor' && movementData.isSprinting && room.hunterSocketId) {
          room.lastFootprintTime = room.lastFootprintTime || {};
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
    } catch (err) {
      console.error('[Error in playerMovement]', err);
    }
  });

  socket.on('startChanneling', () => {
    try {
      if (!currentRoom || !rooms[currentRoom]) return;
      const room = rooms[currentRoom];
      const p = room.players ? room.players[socket.id] : null;
      const task = room.survivorTasks ? room.survivorTasks[socket.id] : null;

      if (!p || p.role !== 'survivor' || !p.alive || p.taskCompleted || !task || room.gameState !== 'in_progress') return;

      const dist = Math.hypot(p.x - task.x, p.y - task.y);
      if (dist < 85) {
        room.activeChannels = room.activeChannels || {};
        room.activeChannels[socket.id] = Date.now();
        socket.emit('channelAccepted', { durationMs: 1250 });
      }
    } catch (err) {
      console.error('[Error in startChanneling]', err);
      logToFile(`[Error in startChanneling] ${err.message}`);
    }
  });

  socket.on('cancelChanneling', () => {
    try {
      if (currentRoom && rooms[currentRoom] && rooms[currentRoom].activeChannels) {
        delete rooms[currentRoom].activeChannels[socket.id];
      }
    } catch (err) {
      console.error('[Error in cancelChanneling]', err);
    }
  });

  socket.on('finishChanneling', () => {
    try {
      if (!currentRoom || !rooms[currentRoom]) return;
      const room = rooms[currentRoom];
      const p = room.players ? room.players[socket.id] : null;
      const task = room.survivorTasks ? room.survivorTasks[socket.id] : null;
      const startTime = room.activeChannels ? room.activeChannels[socket.id] : null;

      if (!p || p.role !== 'survivor' || !p.alive || p.taskCompleted || !task || room.gameState !== 'in_progress' || !startTime) {
        if (room.activeChannels) delete room.activeChannels[socket.id];
        return;
      }

      const elapsed = Date.now() - startTime;
      const dist = Math.hypot(p.x - task.x, p.y - task.y);

      if (elapsed >= CHANNEL_DURATION_MS && dist < 95) {
        p.taskCompleted = true;
        task.completed = true;
        if (room.activeChannels) delete room.activeChannels[socket.id];
        socket.emit('personalTaskDone');
        logToFile(`Survivor ${socket.id} completed terminal in [${currentRoom}]`);
      } else {
        if (room.activeChannels) delete room.activeChannels[socket.id];
      }
    } catch (err) {
      console.error('[Error in finishChanneling]', err);
      logToFile(`[Error in finishChanneling] ${err.message}`);
    }
  });

  socket.on('playerEscaped', () => {
    try {
      if (!currentRoom || !rooms[currentRoom]) return;
      const room = rooms[currentRoom];
      const p = room.players ? room.players[socket.id] : null;

      if (!p || p.role !== 'survivor' || !p.alive || !p.taskCompleted || p.escaped || room.gameState !== 'in_progress') return;

      const dist = Math.hypot(p.x - exitGate.x, p.y - exitGate.y);
      if (dist < 90) {
        p.escaped = true;
        socket.emit('youEscaped');
        socket.to(currentRoom).emit('survivorEscapedNotification', { id: socket.id });
        logToFile(`Survivor ${socket.id} escaped from [${currentRoom}]`);
        checkMatchEndCondition(currentRoom);
      }
    } catch (err) {
      console.error('[Error in playerEscaped]', err);
      logToFile(`[Error in playerEscaped] ${err.message}`);
    }
  });

  socket.on('hunterAttack', () => {
    try {
      if (!currentRoom || !rooms[currentRoom]) return;
      const room = rooms[currentRoom];
      const hunter = room.players ? room.players[socket.id] : null;

      if (!hunter || hunter.role !== 'hunter' || room.gameState !== 'in_progress') return;

      const now = Date.now();
      if (now - (hunter.lastAttackTime || 0) < ATTACK_COOLDOWN_MS) return;
      hunter.lastAttackTime = now;

      socket.emit('attackExecuted', { cooldownMs: ATTACK_COOLDOWN_MS });

      let hitOccurred = false;
      if (room.players) {
        Object.values(room.players).forEach((target) => {
          if (target && target.role === 'survivor' && target.alive && !target.escaped) {
            const dist = Math.hypot(hunter.x - target.x, hunter.y - target.y);
            if (dist <= 105) {
              target.alive = false;
              hitOccurred = true;
              if (room.activeChannels) delete room.activeChannels[target.id];
              io.to(currentRoom).emit('survivorEliminated', { victimId: target.id });
              logToFile(`Hunter eliminated survivor ${target.id} in [${currentRoom}]`);
              checkMatchEndCondition(currentRoom);
            }
          }
        });
      }

      if (hitOccurred) {
        io.to(currentRoom).emit('hunterHitEffect');
      }
    } catch (err) {
      console.error('[Error in hunterAttack]', err);
      logToFile(`[Error in hunterAttack] ${err.message}`);
    }
  });

  socket.on('requestRestart', () => {
    try {
      if (currentRoom && rooms[currentRoom]) {
        startMatch(currentRoom);
      }
    } catch (err) {
      console.error('[Error in requestRestart]', err);
      logToFile(`[Error in requestRestart] ${err.message}`);
    }
  });

  socket.on('disconnect', () => {
    try {
      if (!currentRoom || !rooms[currentRoom]) return;
      const room = rooms[currentRoom];

      if (room.players) delete room.players[socket.id];
      if (room.survivorTasks) delete room.survivorTasks[socket.id];
      if (room.activeChannels) delete room.activeChannels[socket.id];

      const wasHunter = (socket.id === room.hunterSocketId);
      if (wasHunter) {
        room.hunterSocketId = null;
      }

      if (socket.id === room.hostId && room.players) {
        const remainingIds = Object.keys(room.players);
        room.hostId = remainingIds.length > 0 ? remainingIds[0] : null;
      }

      io.to(currentRoom).emit('playerDisconnected', socket.id);

      const remaining = room.players ? Object.keys(room.players).length : 0;
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
          if (wasHunter) {
            room.gameState = 'ended';
            io.to(currentRoom).emit('gameOver', {
              winner: 'survivor',
              message: 'MATCH OVER\nThe Hunter vanished into the mist!\n(Survivors Win by Default)'
            });
          } else {
            checkMatchEndCondition(currentRoom);
          }
        }
      }
    } catch (err) {
      console.error('[Error in disconnect]', err);
      logToFile(`[Error in disconnect] ${err.message}`);
    }
  });
});

const PORT = 3000;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[!] Error: Port ${PORT} is already in use by another running terminal or process.`);
    console.error(`    To fix: Close the other terminal running server.js, or run: Stop-Process -Name node\n`);
  } else {
    console.error('[Server Error]', err);
  }
});

process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Unhandled Rejection]', reason);
});

server.listen(PORT, () => {
  console.log(`After Hours game server listening on http://localhost:${PORT}`);
});