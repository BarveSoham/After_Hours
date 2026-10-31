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
let survivorTasks = {};
let hunterSocketId = null;

// Footprint throttle per survivor
const lastFootprintTime = {};

// Channeling tracking: socketId -> { startTime, taskId }
const activeChannels = {};
const CHANNEL_DURATION_MS = 2400; // ~2.5 seconds with slight network buffer

const ATTACK_COOLDOWN_MS = 1200;

const exitGate = {
  x: 740,
  y: 80,
  w: 60,
  h: 60
};

function startMatch() {
  gameState = 'in_progress';
  survivorTasks = {};

  const playerIds = Object.keys(players);
  const hunterIndex = Math.floor(Math.random() * playerIds.length);
  hunterSocketId = playerIds[hunterIndex];

  const taskLocations = [
    { x: 150, y: 350 },
    { x: 680, y: 480 },
    { x: 500, y: 140 }
  ];
  let taskIndex = 0;

  playerIds.forEach((id) => {
    const isHunter = (id === hunterSocketId);
    players[id].role = isHunter ? 'hunter' : 'survivor';
    players[id].alive = true;
    players[id].escaped = false;
    players[id].taskCompleted = false;
    players[id].lastAttackTime = 0;

    players[id].x = isHunter ? 120 : (taskIndex === 0 ? 320 : 480);
    players[id].y = isHunter ? 120 : 380;

    if (!isHunter) {
      const loc = taskLocations[taskIndex % taskLocations.length];
      survivorTasks[id] = {
        x: loc.x,
        y: loc.y,
        completed: false
      };
      taskIndex++;
    }
  });

  io.emit('matchStarted', {
    players,
    survivorTasks,
    exitGate
  });
  console.log(`[!] Match started. Hunter: ${hunterSocketId}`);
}

function checkMatchEndCondition() {
  const survivors = Object.values(players).filter(p => p.role === 'survivor');
  if (survivors.length === 0) return;

  const allDone = survivors.every(s => !s.alive || s.escaped);

  if (allDone) {
    gameState = 'ended';
    const escapedCount = survivors.filter(s => s.escaped).length;

    if (escapedCount === 0) {
      io.emit('gameOver', {
        winner: 'hunter',
        message: 'MATCH OVER\nAll survivors were eliminated!'
      });
    } else {
      io.emit('gameOver', {
        winner: 'survivor',
        message: 'MATCH OVER\nSurvivors Escaped!'
      });
    }
  }
}

io.on('connection', (socket) => {
  console.log(`[+] Player joined: ${socket.id}`);

  players[socket.id] = {
    id: socket.id,
    x: 400,
    y: 300,
    angle: 0,
    role: 'waiting',
    alive: true,
    escaped: false,
    taskCompleted: false,
    lastAttackTime: 0
  };

  const currentCount = Object.keys(players).length;
  io.emit('lobbyUpdate', {
    count: currentCount,
    required: REQUIRED_PLAYERS,
    gameState: gameState
  });

  if (currentCount === REQUIRED_PLAYERS && gameState === 'waiting') {
    startMatch();
  }

  socket.on('playerMovement', (movementData) => {
    const p = players[socket.id];
    if (p && gameState === 'in_progress' && p.alive && !p.escaped) {
      p.x = movementData.x;
      p.y = movementData.y;
      p.angle = movementData.angle;
      socket.broadcast.emit('playerMoved', p);

      if (p.role === 'survivor' && movementData.isSprinting && hunterSocketId) {
        const now = Date.now();
        const lastTime = lastFootprintTime[socket.id] || 0;
        if (now - lastTime > 220) {
          lastFootprintTime[socket.id] = now;
          io.to(hunterSocketId).emit('spawnFootprint', {
            x: p.x,
            y: p.y,
            angle: p.angle
          });
        }
      }
    }
  });

  // Start Channeling Task
  socket.on('startChanneling', () => {
    const p = players[socket.id];
    const task = survivorTasks[socket.id];
    if (!p || p.role !== 'survivor' || !p.alive || p.taskCompleted || !task || gameState !== 'in_progress') return;

    const dist = Math.hypot(p.x - task.x, p.y - task.y);
    if (dist < 65) {
      activeChannels[socket.id] = Date.now();
      socket.emit('channelAccepted', { durationMs: 2500 });
    }
  });

  // Cancel Channeling Task
  socket.on('cancelChanneling', () => {
    delete activeChannels[socket.id];
  });

  // Complete Channeling Task
  socket.on('finishChanneling', () => {
    const p = players[socket.id];
    const task = survivorTasks[socket.id];
    const startTime = activeChannels[socket.id];

    if (!p || p.role !== 'survivor' || !p.alive || p.taskCompleted || !task || gameState !== 'in_progress' || !startTime) {
      delete activeChannels[socket.id];
      return;
    }

    const elapsed = Date.now() - startTime;
    const dist = Math.hypot(p.x - task.x, p.y - task.y);

    if (elapsed >= CHANNEL_DURATION_MS && dist < 70) {
      p.taskCompleted = true;
      task.completed = true;
      delete activeChannels[socket.id];
      socket.emit('personalTaskDone');
      console.log(`[!] Survivor ${socket.id} completed channeling task!`);
    } else {
      delete activeChannels[socket.id];
    }
  });

  socket.on('playerEscaped', () => {
    const p = players[socket.id];
    if (!p || p.role !== 'survivor' || !p.alive || !p.taskCompleted || p.escaped || gameState !== 'in_progress') return;

    const dist = Math.hypot(p.x - exitGate.x, p.y - exitGate.y);
    if (dist < 60) {
      p.escaped = true;
      socket.emit('youEscaped');
      socket.broadcast.emit('survivorEscapedNotification', { id: socket.id });
      console.log(`[!] Survivor ${socket.id} escaped!`);
      checkMatchEndCondition();
    }
  });

  socket.on('hunterAttack', () => {
    const hunter = players[socket.id];
    if (!hunter || hunter.role !== 'hunter' || gameState !== 'in_progress') return;

    const now = Date.now();
    if (now - hunter.lastAttackTime < ATTACK_COOLDOWN_MS) {
      return;
    }
    hunter.lastAttackTime = now;

    socket.emit('attackExecuted', { cooldownMs: ATTACK_COOLDOWN_MS });

    let hitOccurred = false;
    Object.values(players).forEach((target) => {
      if (target.role === 'survivor' && target.alive && !target.escaped) {
        const dist = Math.hypot(hunter.x - target.x, hunter.y - target.y);
        if (dist < 65) {
          target.alive = false;
          hitOccurred = true;
          delete activeChannels[target.id]; // Cancel channel on hit
          io.emit('survivorEliminated', { victimId: target.id });
          console.log(`[x] Survivor ${target.id} eliminated!`);
          checkMatchEndCondition();
        }
      }
    });

    if (hitOccurred) {
      io.emit('hunterHitEffect');
    }
  });

  socket.on('requestRestart', () => {
    if (gameState === 'ended') {
      startMatch();
    }
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    delete survivorTasks[socket.id];
    delete lastFootprintTime[socket.id];
    delete activeChannels[socket.id];

    if (socket.id === hunterSocketId) {
      hunterSocketId = null;
    }

    io.emit('playerDisconnected', socket.id);

    const remaining = Object.keys(players).length;
    if (remaining < REQUIRED_PLAYERS) {
      gameState = 'waiting';
      io.emit('lobbyUpdate', {
        count: remaining,
        required: REQUIRED_PLAYERS,
        gameState: gameState
      });
    } else if (gameState === 'in_progress') {
      checkMatchEndCondition();
    }
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`After Hours game server listening on http://localhost:${PORT}`);
});