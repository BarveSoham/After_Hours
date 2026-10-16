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

// Individual items for survivors: map of playerId -> item coordinates & status
let survivorTasks = {};

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
  const hunterId = playerIds[hunterIndex];

  // Move task locations into open hallways away from obstacles
  const taskLocations = [
    { x: 150, y: 350 }, // Open left area
    { x: 680, y: 480 }, // Open bottom-right area
    { x: 500, y: 140 }  // Open top-mid area
  ];
  let taskIndex = 0;

  playerIds.forEach((id) => {
    const isHunter = (id === hunterId);
    players[id].role = isHunter ? 'hunter' : 'survivor';
    players[id].alive = true;
    players[id].escaped = false;
    players[id].taskCompleted = false;

    // Spawns
    players[id].x = isHunter ? 120 : Math.floor(Math.random() * 200) + 300;
    players[id].y = isHunter ? 120 : Math.floor(Math.random() * 200) + 300;

    // Assign an individual task location per survivor
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
  console.log(`[!] Match started. Hunter: ${hunterId}`);
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
        message: 'MATCH OVER\nAll survivors are eliminated!'
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
    taskCompleted: false
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

  // Sync position
  socket.on('playerMovement', (movementData) => {
    const p = players[socket.id];
    if (p && gameState === 'in_progress' && p.alive && !p.escaped) {
      p.x = movementData.x;
      p.y = movementData.y;
      p.angle = movementData.angle;
      socket.broadcast.emit('playerMoved', p);
    }
  });

  // Individual task pickup
  socket.on('pickupItem', () => {
    const p = players[socket.id];
    const task = survivorTasks[socket.id];

    if (!p || p.role !== 'survivor' || !p.alive || p.taskCompleted || !task || gameState !== 'in_progress') return;

    const dist = Math.hypot(p.x - task.x, p.y - task.y);
    if (dist < 60) {
      p.taskCompleted = true;
      task.completed = true;
      socket.emit('personalTaskDone');
      console.log(`[!] Survivor ${socket.id} finished their individual task!`);
    }
  });

  // Individual survivor escape
  socket.on('playerEscaped', () => {
    const p = players[socket.id];
    if (!p || p.role !== 'survivor' || !p.alive || !p.taskCompleted || p.escaped || gameState !== 'in_progress') return;

    const dist = Math.hypot(p.x - exitGate.x, p.y - exitGate.y);
    if (dist < 60) {
      p.escaped = true;
      socket.emit('youEscaped');
      socket.broadcast.emit('survivorEscapedNotification', { id: socket.id });
      console.log(`[!] Survivor ${socket.id} made it to the exit and escaped!`);
      checkMatchEndCondition();
    }
  });

  // Hunter attacks (individual kill)
  socket.on('hunterAttack', () => {
    const hunter = players[socket.id];
    if (!hunter || hunter.role !== 'hunter' || gameState !== 'in_progress') return;

    Object.values(players).forEach((target) => {
      if (target.role === 'survivor' && target.alive && !target.escaped) {
        const dist = Math.hypot(hunter.x - target.x, hunter.y - target.y);
        if (dist < 65) {
          target.alive = false;
          io.emit('survivorEliminated', { victimId: target.id });
          console.log(`[x] Survivor ${target.id} eliminated by Hunter!`);
          checkMatchEndCondition();
        }
      }
    });
  });

  // Replay
  socket.on('requestRestart', () => {
    if (gameState === 'ended') {
      startMatch();
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    delete players[socket.id];
    delete survivorTasks[socket.id];
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