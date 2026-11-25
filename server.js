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

// 4 Potential Exit Gate Candidates along the facility perimeters
const ALL_EXIT_GATES = [
  { id: 'east', name: 'East Airlock', x: 1840, y: 750, w: 60, h: 120 },
  { id: 'west', name: 'West Bulkhead', x: 160, y: 750, w: 60, h: 120 },
  { id: 'north', name: 'North Ventilation', x: 1000, y: 120, w: 120, h: 60 },
  { id: 'south', name: 'South Service Dock', x: 1000, y: 1380, w: 120, h: 60 }
];

// All 6 distinct combinations of 2 gates to guarantee rotation
const EXIT_GATE_PAIRS = [
  [ALL_EXIT_GATES[0], ALL_EXIT_GATES[1]], // East + West
  [ALL_EXIT_GATES[2], ALL_EXIT_GATES[3]], // North + South
  [ALL_EXIT_GATES[0], ALL_EXIT_GATES[2]], // East + North
  [ALL_EXIT_GATES[1], ALL_EXIT_GATES[3]], // West + South
  [ALL_EXIT_GATES[0], ALL_EXIT_GATES[3]], // East + South
  [ALL_EXIT_GATES[1], ALL_EXIT_GATES[2]], // West + North
];

// Distinct spawns in the surrounding outer rooms
const SURVIVOR_SPAWNS = [
  { x: 300, y: 250 },   // North-West Room
  { x: 300, y: 1250 }   // South-West Room
];

// 8 Distinct Terminal Locations distributed across all map sectors
const ALL_TASK_LOCATIONS = [
  { name: 'North Lab', x: 1000, y: 240 },
  { name: 'South Storage', x: 1000, y: 1260 },
  { name: 'North-East Archive', x: 1700, y: 240 },
  { name: 'South-East Substation', x: 1700, y: 1260 },
  { name: 'North-West Medical', x: 300, y: 240 },
  { name: 'South-West Operations', x: 300, y: 1260 },
  { name: 'Central Quad West', x: 760, y: 750 },
  { name: 'Central Quad East', x: 1240, y: 750 }
];
const CHANNEL_DURATION_MS = 1200;
const ATTACK_COOLDOWN_MS = 1200;

function fisherYatesShuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startMatch(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  const playerIds = Object.keys(room.players);
  if (playerIds.length < 1) return; // Allow 1 player for solo test, 2+ for multiplayer

  room.gameState = 'in_progress';
  room.survivorTasks = {};
  room.activeChannels = {};
  room.lastFootprintTime = {};

  // Guarantee that the 2 exit gates change every single round
  room.lastExitPairIndex = (typeof room.lastExitPairIndex === 'number') ? room.lastExitPairIndex : -1;
  let nextPairIndex;
  do {
    nextPairIndex = Math.floor(Math.random() * EXIT_GATE_PAIRS.length);
  } while (nextPairIndex === room.lastExitPairIndex && EXIT_GATE_PAIRS.length > 1);

  room.lastExitPairIndex = nextPairIndex;
  const chosenPair = EXIT_GATE_PAIRS[nextPairIndex];
  // Randomly alternate which gate is primary vs secondary
  room.activeExitGates = (Math.random() > 0.5)
    ? [chosenPair[0], chosenPair[1]]
    : [chosenPair[1], chosenPair[0]];

  // Shuffle terminal locations with unbiased Fisher-Yates
  const shuffledTasks = fisherYatesShuffle(ALL_TASK_LOCATIONS);

  if (playerIds.length === 1) {
    // Solo playtest mode: rotate task location each round
    room.lastTaskIndex = (typeof room.lastTaskIndex === 'number')
      ? (room.lastTaskIndex + 1) % ALL_TASK_LOCATIONS.length
      : Math.floor(Math.random() * ALL_TASK_LOCATIONS.length);
    const soloTask = ALL_TASK_LOCATIONS[room.lastTaskIndex];

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
      x: soloTask.x,
      y: soloTask.y,
      completed: false
    };
  } else {
    // Hunter selection rotation: avoid choosing the same hunter consecutively
    room.lastHunterSocketId = room.lastHunterSocketId || null;
    const candidates = playerIds.filter(id => id !== room.lastHunterSocketId);
    const eligible = candidates.length > 0 ? candidates : playerIds;
    const hunterIndex = Math.floor(Math.random() * eligible.length);
    room.hunterSocketId = eligible[hunterIndex];
    room.lastHunterSocketId = room.hunterSocketId;

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

        const loc = shuffledTasks[survivorCount % shuffledTasks.length];
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
    exitGates: room.activeExitGates,
    exitGate: room.activeExitGates[0]
  });
  const exitNames = room.activeExitGates.map(g => g.name).join(' & ');
  console.log(`[!] Match started in [${roomCode}] with ${playerIds.length} player(s). Hunter: ${room.hunterSocketId || 'None (Solo Test)'}. Exits: ${exitNames}`);
  logToFile(`Match started in [${roomCode}]. Exits: ${exitNames}. Task: ${playerIds.length === 1 ? ALL_TASK_LOCATIONS[room.lastTaskIndex].name : 'Multi'}`);
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
        lastHunterSocketId: null,
        activeExitGates: [],
        activeChannels: {},
        lastFootprintTime: {}
      };
    }

    const room = rooms[currentRoom];

    if (room.gameState === 'in_progress') {
      // Reconnecting or joining midgame
      room.players[socket.id] = {
        id: socket.id,
        name: name || 'Lost_Seeker',
        x: 1000,
        y: 750,
        angle: 0,
        role: 'survivor',
        alive: true,
        escaped: false,
        ready: true,
        taskCompleted: false,
        lastAttackTime: 0
      };

      console.log(`[Midgame Join] ${name} (${socket.id}) connected to in-progress [${currentRoom}]`);

      socket.emit('matchStarted', {
        players: room.players,
        survivorTasks: room.survivorTasks,
        exitGates: room.activeExitGates,
        exitGate: room.activeExitGates[0]
      });

      socket.to(currentRoom).emit('playerJoinedMidgame', room.players[socket.id]);
    } else {
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

      console.log(`[+] ${name} (${socket.id}) joined [${currentRoom}] (State: ${room.gameState})`);

      // If room is launching from lobby and all expected players have arrived:
      if (room.gameState === 'launching') {
        const joinedCount = Object.keys(room.players).length;
        if (joinedCount >= (room.expectedCount || 1)) {
          if (room.launchTimeout) {
            clearTimeout(room.launchTimeout);
            room.launchTimeout = null;
          }
          console.log(`[Launch] All ${joinedCount} players arrived in [${currentRoom}]. Starting match!`);
          setTimeout(() => startMatch(currentRoom), 250);
        }
      } else {
        io.to(currentRoom).emit('lobbyRosterUpdate', {
          roomCode: currentRoom,
          hostId: room.hostId,
          players: Object.values(room.players),
          gameState: room.gameState
        });
      }
    }
  });

  socket.on('commenceMatchRequest', () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    if (socket.id !== room.hostId) return;

    room.expectedCount = Object.keys(room.players).length;
    room.gameState = 'launching';
    room.players = {}; // Reset player sockets for fresh game.html connections!
    room.hunterSocketId = null;

    console.log(`[Lobby] Host commenced match in [${currentRoom}]. Expecting ${room.expectedCount} player(s).`);

    // Safety timeout: if someone didn't join within 4 seconds, start with whoever arrived
    if (room.launchTimeout) clearTimeout(room.launchTimeout);
    room.launchTimeout = setTimeout(() => {
      if (rooms[currentRoom] && rooms[currentRoom].gameState === 'launching') {
        const count = Object.keys(rooms[currentRoom].players).length;
        console.log(`[Timeout Check] Launching with ${count} arrived player(s) in [${currentRoom}]`);
        if (count >= 1) {
          startMatch(currentRoom);
        }
      }
    }, 4000);

    io.to(currentRoom).emit('commenceDescent', { roomCode: currentRoom });
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

      const gates = (room.activeExitGates && room.activeExitGates.length > 0) ? room.activeExitGates : ALL_EXIT_GATES.slice(0, 2);
      const usedGate = gates.find(gate => Math.hypot(p.x - gate.x, p.y - gate.y) < 105);

      if (usedGate) {
        p.escaped = true;
        socket.emit('youEscaped');
        socket.to(currentRoom).emit('survivorEscapedNotification', { id: socket.id });
        logToFile(`Survivor ${socket.id} escaped via [${usedGate.name}] from [${currentRoom}]`);
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

  socket.on('kickPlayer', ({ targetId }) => {
    try {
      if (!currentRoom || !rooms[currentRoom]) return;
      const room = rooms[currentRoom];
      if (socket.id === room.hostId && targetId !== socket.id) {
        io.to(targetId).emit('kickedFromLobby');
        if (room.players) delete room.players[targetId];
        io.to(currentRoom).emit('lobbyRosterUpdate', {
          roomCode: currentRoom,
          hostId: room.hostId,
          players: Object.values(room.players).filter(p => p.connected !== false),
          gameState: room.gameState
        });
      }
    } catch (err) {
      console.error('[Error in kickPlayer]', err);
    }
  });

  socket.on('disconnect', () => {
    try {
      if (!currentRoom || !rooms[currentRoom]) return;
      const room = rooms[currentRoom];

      // While launching from lobby, sockets disconnect as pages transition - do not delete room
      if (room.gameState === 'launching') {
        return;
      }

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
        if (room.launchTimeout) clearTimeout(room.launchTimeout);
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