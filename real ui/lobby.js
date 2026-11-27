import { io } from 'socket.io-client';

// Parse URL query params
const urlParams = new URLSearchParams(window.location.search);
const paramRoom = urlParams.get('room');
const paramScreen = urlParams.get('screen');
const paramName = urlParams.get('name');

// Prefer tab-specific sessionStorage so opening multiple tabs in the same browser for local testing generates distinct aliases
const sessionName = sessionStorage.getItem('afterHoursPlayerName');
const savedName = localStorage.getItem('afterHoursPlayerName');
const initialName = (paramName || sessionName || savedName || 'Wanderer_' + Math.floor(100 + Math.random() * 900)).trim();

const state = {
  screen: (paramScreen === 'LOBBY' && paramRoom) ? 'LOBBY' : 'MENU',
  playerName: initialName,
  lobby: {
    roomCode: paramRoom ? paramRoom.toUpperCase() : 'AFH-409',
    isHost: true,
    players: []
  },
  assignedRole: 'SURVIVOR'
};

let audioCtx = null;

// Connect to Socket.IO server with direct websocket transport prioritized
const socket = io({ transports: ['websocket', 'polling'] });

socket.on('connect', () => {
  console.log('[Lobby Socket] Connected. ID:', socket.id);
  if (state.screen === 'LOBBY' && state.lobby.roomCode) {
    socket.emit('joinRoom', {
      roomCode: state.lobby.roomCode,
      name: state.playerName,
      asLobby: true
    });
  }
});

socket.on('lobbyRosterUpdate', (data) => {
  console.log('[Lobby] Roster update received:', data);
  state.lobby.roomCode = data.roomCode;
  state.lobby.isHost = (socket.id === data.hostId);

  const seen = new Set();
  const deduped = [];
  (data.players || []).forEach(p => {
    const key = (p.name || '').trim().toLowerCase();
    if (!key) return;
    const isSelf = (p.id === socket.id);
    if (isSelf) {
      const idx = deduped.findIndex(x => (x.name || '').trim().toLowerCase() === key);
      const entry = {
        id: p.id,
        name: p.name || 'Lost Seeker',
        isSelf: true,
        ready: !!p.ready,
        role: p.role
      };
      if (idx !== -1) {
        deduped[idx] = entry;
      } else {
        deduped.push(entry);
      }
      seen.add(key);
    } else if (!seen.has(key)) {
      seen.add(key);
      deduped.push({
        id: p.id,
        name: p.name || 'Lost Seeker',
        isSelf: false,
        ready: !!p.ready,
        role: p.role
      });
    }
  });

  state.lobby.players = deduped;

  // Sync tab alias if server de-duplicated multi-tab testing
  const selfEntry = deduped.find(p => p.isSelf);
  if (selfEntry && selfEntry.name && selfEntry.name !== state.playerName) {
    state.playerName = selfEntry.name;
    sessionStorage.setItem('afterHoursPlayerName', selfEntry.name);
  }

  if (state.screen === 'LOBBY') {
    render();
  }
});

socket.on('kickedFromLobby', () => {
  showToast('Removed from lobby');
  go('MENU');
});

socket.on('commenceDescent', (data) => {
  showToast('Descending into the Archives...');
  playChime('hunter');
  setTimeout(() => {
    const dest = `/game.html?room=${encodeURIComponent(data.roomCode)}&name=${encodeURIComponent(state.playerName)}`;
    window.location.href = dest;
  }, 700);
});

function playChime(type = 'hover') {
  try {
    const savedVol = Number(localStorage.getItem('afterHoursVolume') ?? 70);
    const vol = savedVol / 100;
    if (vol <= 0) return;

    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    if (type === 'hunter') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(110, now);
      osc.frequency.exponentialRampToValueAtTime(55, now + 0.45);
      gain.gain.setValueAtTime(0.08 * vol, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.48);
    } else if (type === 'select') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.exponentialRampToValueAtTime(560, now + 0.16);
      gain.gain.setValueAtTime(0.06 * vol, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(360, now + 0.08);
      gain.gain.setValueAtTime(0.03 * vol, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    }

    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.5);
  } catch (e) {}
}

function showToast(message) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  container.innerHTML = `
    <div class="screen-fade px-5 py-2 bg-[#091324]/85 border border-[#436b95]/35 text-xs tracking-[0.25em] uppercase text-[#dce7f5] glow-teal">
      ${message}
    </div>
  `;
  setTimeout(() => {
    if (container) container.innerHTML = '';
  }, 2000);
}

function updatePlayerName(val) {
  const clean = (val || '').trim() || 'Wanderer';
  state.playerName = clean;
  sessionStorage.setItem('afterHoursPlayerName', clean);
  localStorage.setItem('afterHoursPlayerName', clean);
  if (state.screen === 'LOBBY') {
    socket.emit('joinRoom', {
      roomCode: state.lobby.roomCode,
      name: clean,
      asLobby: true
    });
  }
}

function go(screenName) {
  playChime('select');
  if (state.screen === 'LOBBY' && screenName === 'MENU') {
    window.history.replaceState({}, '', window.location.pathname);
  }
  state.screen = screenName;
  render();
}

function render() {
  const viewport = document.getElementById('app-viewport');
  const topLeft = document.getElementById('topbar-left');
  if (!viewport || !topLeft) return;
  topLeft.innerHTML = '';

  if (state.screen === 'MENU') {
    viewport.innerHTML = renderMainMenu();
  } else if (state.screen === 'JOIN_LOBBY') {
    topLeft.innerHTML = `<button onclick="go('MENU')" class="float-link font-eerie text-2xl sm:text-3xl tracking-[0.16em]">Back</button>`;
    viewport.innerHTML = renderJoinLobby();
    setTimeout(() => {
      const input = document.getElementById('room-code-field');
      if (input) input.focus();
    }, 50);
  } else if (state.screen === 'LOBBY') {
    topLeft.innerHTML = `<button onclick="go('MENU')" class="float-link font-eerie text-2xl sm:text-3xl tracking-[0.16em]">Leave</button>`;
    viewport.innerHTML = renderLobby();
  } else if (state.screen === 'ROLE_REVEAL') {
    topLeft.innerHTML = `<button onclick="go('LOBBY')" class="float-link font-eerie text-2xl sm:text-3xl tracking-[0.16em]">Lobby</button>`;
    viewport.innerHTML = renderRoleReveal();
  }
}

/* ============================================================================
   1. MAIN MENU
============================================================================ */
function renderMainMenu() {
  return `
    <div class="screen-fade flex flex-col items-center text-center my-auto pb-12">
      <div class="title-bob relative inline-flex flex-col items-center select-none mb-10" aria-label="AFTER HOURS">
        <span class="absolute -left-8 top-6 w-3 h-3 rounded-full bg-[#dce7f5] opacity-90 shadow-[0_0_12px_#dce7f5]"></span>
        <span class="absolute -left-12 top-12 w-1.5 h-1.5 rounded-full bg-[#dce7f5] opacity-75"></span>
        <span class="absolute -left-6 top-16 w-2 h-2 rounded-full bg-[#dce7f5] opacity-80"></span>
        <span class="absolute -right-8 bottom-8 w-3 h-3 rounded-full bg-[#dce7f5] opacity-85 shadow-[0_0_12px_#dce7f5]"></span>
        <span class="absolute -right-11 bottom-4 w-1.5 h-1.5 rounded-full bg-[#dce7f5] opacity-70"></span>
        <span class="absolute right-4 -top-3 w-2 h-2 rounded-full bg-[#dce7f5] opacity-80"></span>

        <h1 class="font-haunted font-extrabold text-[#edf4fc] glow-mist leading-[0.82] tracking-[0.02em] flex flex-col items-center">
          <span class="block text-7xl sm:text-8xl md:text-[7.75rem] lg:text-[9rem] -rotate-2">
            <span class="inline-block text-[1.15em] -translate-y-1">A</span>fter
          </span>
          <span class="block text-7xl sm:text-8xl md:text-[8.25rem] lg:text-[9.5rem] rotate-1 -mt-2 sm:-mt-3">
            <span class="inline-block text-[1.14em]">H</span>our<span class="inline-block text-[1.18em] translate-y-1.5 -rotate-3">S</span>
          </span>
        </h1>
      </div>

      <div class="mb-7 flex flex-col items-center">
        <label for="player-name-field" class="text-[10px] tracking-[0.32em] uppercase text-[#6e94b8]/80 mb-1.5">Player Alias</label>
        <input id="player-name-field" type="text" maxlength="15" value="${state.playerName}"
          onchange="updatePlayerName(this.value)"
          oninput="updatePlayerName(this.value)"
          class="bg-transparent border-b border-[#6e94b8]/40 focus:border-[#dce7f5] outline-none text-center font-serif-clean text-xl tracking-[0.14em] text-[#edf4fc] glow-teal px-3 py-1 w-48 transition" />
      </div>

      <nav class="flex flex-col items-center gap-5">
        <button onmouseenter="playChime('hover')" onclick="createLobby()"
          class="float-link group font-eerie text-2xl sm:text-[26px] tracking-[0.12em] inline-flex items-center gap-3">
          <span class="opacity-0 -translate-x-1 group-hover:opacity-80 group-hover:translate-x-0 transition-all text-base text-[#7aa3cc]">›</span>
          <span>Create Lobby</span>
          <span class="opacity-0 translate-x-1 group-hover:opacity-80 group-hover:translate-x-0 transition-all text-base text-[#7aa3cc]">‹</span>
        </button>

        <button onmouseenter="playChime('hover')" onclick="go('JOIN_LOBBY')"
          class="float-link group font-eerie text-2xl sm:text-[26px] tracking-[0.12em] inline-flex items-center gap-3">
          <span class="opacity-0 -translate-x-1 group-hover:opacity-80 group-hover:translate-x-0 transition-all text-base text-[#7aa3cc]">›</span>
          <span>Join Lobby</span>
          <span class="opacity-0 translate-x-1 group-hover:opacity-80 group-hover:translate-x-0 transition-all text-base text-[#7aa3cc]">‹</span>
        </button>

        <a href="how-to-play.html" onmouseenter="playChime('hover')" onclick="playChime('select')"
          class="float-link group font-eerie text-2xl sm:text-[26px] tracking-[0.12em] inline-flex items-center gap-3">
          <span class="opacity-0 -translate-x-1 group-hover:opacity-80 group-hover:translate-x-0 transition-all text-base text-[#7aa3cc]">›</span>
          <span>How to Play</span>
          <span class="opacity-0 translate-x-1 group-hover:opacity-80 group-hover:translate-x-0 transition-all text-base text-[#7aa3cc]">‹</span>
        </a>

        <a href="settings.html" onmouseenter="playChime('hover')" onclick="playChime('select')"
          class="float-link group font-eerie text-2xl sm:text-[26px] tracking-[0.12em] inline-flex items-center gap-3">
          <span class="opacity-0 -translate-x-1 group-hover:opacity-80 group-hover:translate-x-0 transition-all text-base text-[#7aa3cc]">›</span>
          <span>Settings</span>
          <span class="opacity-0 translate-x-1 group-hover:opacity-80 group-hover:translate-x-0 transition-all text-base text-[#7aa3cc]">‹</span>
        </a>
      </nav>
    </div>
  `;
}

/* ============================================================================
   2. JOIN LOBBY SCREEN
============================================================================ */
function renderJoinLobby() {
  return `
    <div class="screen-fade w-full max-w-md flex flex-col items-center text-center my-auto pb-12">
      <div class="text-[10px] tracking-[0.32em] uppercase text-[#6e94b8]/80 mb-2">
        After Curfew
      </div>
      <h2 class="font-eerie text-3xl sm:text-5xl tracking-[0.18em] text-[#dce7f5] glow-mist mb-10 font-normal">
        Join Lobby
      </h2>

      <label for="room-code-field" class="text-xs tracking-[0.26em] uppercase text-[#8cb2d6]/85 mb-3">
        Enter Room Code
      </label>
      <input id="room-code-field" type="text" maxlength="8" value="${state.lobby.roomCode}"
        onkeydown="if(event.key==='Enter') confirmJoin()"
        class="w-56 bg-transparent border-b border-[#6e94b8]/55 focus:border-[#dce7f5] outline-none py-2.5 text-center font-mono-clean text-2xl tracking-[0.28em] uppercase text-[#edf4fc] glow-teal mb-12" />

      <div class="flex items-center gap-12">
        <button onmouseenter="playChime('hover')" onclick="confirmJoin()"
          class="float-link font-eerie text-2xl tracking-[0.14em] text-[#dce7f5] glow-mist">
          Join
        </button>
        <button onmouseenter="playChime('hover')" onclick="go('MENU')"
          class="float-link font-eerie text-2xl tracking-[0.14em] opacity-70">
          Back
        </button>
      </div>
    </div>
  `;
}

function createLobby() {
  const code = 'AFH-' + Math.floor(100 + Math.random() * 900);
  state.lobby.roomCode = code;
  state.lobby.isHost = true;
  socket.emit('joinRoom', { roomCode: code, name: state.playerName, asLobby: true });
  window.history.replaceState({}, '', `?room=${encodeURIComponent(code)}&screen=LOBBY`);
  go('LOBBY');
}

function confirmJoin() {
  const val = (document.getElementById('room-code-field')?.value || state.lobby.roomCode).trim().toUpperCase();
  if (val.length < 3) {
    showToast('Enter Valid Code');
    return;
  }
  state.lobby.roomCode = val;
  state.lobby.isHost = false;
  socket.emit('joinRoom', { roomCode: val, name: state.playerName, asLobby: true });
  window.history.replaceState({}, '', `?room=${encodeURIComponent(val)}&screen=LOBBY`);
  go('LOBBY');
}

/* ============================================================================
   3. CREATE / ACTIVE LOBBY SCREEN
============================================================================ */
function renderLobby() {
  const players = state.lobby.players;
  const self = players.find(p => p.isSelf);
  const isHost = state.lobby.isHost;
  const canStart = isHost && players.length >= 1;

  let rowsHTML = '';
  for (let i = 0; i < 6; i++) {
    const p = players[i];
    if (p) {
      rowsHTML += `
        <div class="flex items-center justify-between py-2.5 border-b border-[#436b95]/22">
          <div class="flex items-center gap-3.5">
            <span class="w-1.5 h-1.5 rounded-full ${p.ready ? 'bg-[#7aa3cc] shadow-[0_0_8px_#7aa3cc]' : 'bg-[#436b95]/40'}"></span>
            <span class="font-serif-clean text-lg tracking-[0.1em] text-[#dce7f5]">${p.name}${p.isSelf ? ' <span class="text-xs text-[#8cb2d6]/70">(You)</span>' : ''}</span>
          </div>
          <div class="flex items-center gap-4">
            <span class="text-xs tracking-[0.18em] uppercase ${p.ready ? 'text-[#6e94b8]' : 'text-[#436b95]/60'}">
              ${p.ready ? 'Ready' : 'Waiting'}
            </span>
            ${isHost && !p.isSelf ? `
              <button onclick="kickPlayer('${p.id}')" class="text-xs text-[#436b95] hover:text-[#dce7f5] transition px-1" title="Remove Player">
                ✕
              </button>
            ` : ''}
          </div>
        </div>
      `;
    } else {
      rowsHTML += `
        <div class="flex items-center justify-between py-2.5 border-b border-[#436b95]/12 opacity-35">
          <div class="flex items-center gap-3.5">
            <span class="w-1.5 h-1.5 rounded-full bg-[#436b95]/30"></span>
            <span class="font-serif-clean italic text-base tracking-[0.12em] text-[#6e94b8]">Empty Slot</span>
          </div>
        </div>
      `;
    }
  }

  let actionsHTML = '';
  if (isHost) {
    actionsHTML = `
      <div class="flex items-center gap-12">
        <button onmouseenter="playChime('hover')" onclick="toggleReady()"
          class="float-link font-eerie text-2xl tracking-[0.14em] transition-all duration-300 ${self?.ready ? '!text-white scale-105 [text-shadow:0_0_12px_#ffffff,0_0_26px_#dce7f5,0_0_48px_#8fb8e0]' : 'opacity-65'}">
          Ready
        </button>
        <button onmouseenter="playChime('hover')" onclick="beginMatch()" ${!canStart ? 'disabled' : ''}
          class="float-link font-eerie text-2xl tracking-[0.14em] ${canStart ? 'text-[#dce7f5] glow-mist' : 'opacity-25 pointer-events-none'}">
          Start Descent
        </button>
      </div>
    `;
  } else {
    actionsHTML = `
      <div class="flex items-center gap-12">
        <button onmouseenter="playChime('hover')" onclick="toggleReady()"
          class="float-link font-eerie text-2xl tracking-[0.14em] transition-all duration-300 ${self?.ready ? '!text-white scale-105 [text-shadow:0_0_12px_#ffffff,0_0_26px_#dce7f5,0_0_48px_#8fb8e0]' : 'opacity-65'}">
          Ready
        </button>
        <span class="font-serif-clean italic text-sm tracking-[0.16em] text-[#6e94b8]/75">
          Waiting for Host...
        </span>
      </div>
    `;
  }

  return `
    <div class="screen-fade w-full max-w-md flex flex-col items-center my-auto pb-8">
      <button onclick="copyCode()" class="group flex flex-col items-center mb-8">
        <span class="text-[10px] tracking-[0.3em] uppercase text-[#8cb2d6]/85 mb-1">Room Code</span>
        <span class="font-mono-clean text-xl tracking-[0.28em] text-[#edf4fc] glow-teal group-hover:glow-mist transition">
          ${state.lobby.roomCode}
        </span>
        <span class="w-24 h-[1px] mt-2 bg-gradient-to-r from-transparent via-[#8cb2d6]/50 to-transparent"></span>
      </button>

      <div class="w-full mb-10">
        ${rowsHTML}
      </div>

      ${actionsHTML}
    </div>
  `;
}

function copyCode() {
  playChime('select');
  if (navigator.clipboard) navigator.clipboard.writeText(state.lobby.roomCode).catch(() => {});
  showToast('Code Copied');
}

function kickPlayer(targetId) {
  playChime('hover');
  socket.emit('kickPlayer', { targetId });
}

function toggleReady() {
  playChime('select');
  socket.emit('toggleReady');
}

function beginMatch() {
  playChime('select');
  socket.emit('commenceMatchRequest');
}

function renderRoleReveal() {
  const isHunter = state.assignedRole === 'HUNTER';
  return `
    <div class="screen-fade flex flex-col items-center justify-center text-center my-auto pb-10">
      <div class="text-xs tracking-[0.34em] uppercase text-[#8cb2d6] mb-3">
        You Are
      </div>
      <h2 class="font-eerie text-5xl sm:text-7xl tracking-[0.22em] uppercase ${isHunter ? 'text-[#9e242e] glow-crimson' : 'text-[#edf4fc] glow-mist'} mb-3 font-normal">
        ${isHunter ? 'Hunter' : 'Survivor'}
      </h2>
      <div class="w-36 h-[1px] mb-4 bg-gradient-to-r from-transparent ${isHunter ? 'via-[#9e242e]/70' : 'via-[#8cb2d6]/65'} to-transparent"></div>
      <p class="font-serif-clean italic text-lg text-[#edf4fc]/85 tracking-wider mb-10">
        ${isHunter ? 'Eliminate them before the rituals finish.' : 'Complete the rituals and survive.'}
      </p>
      <button onmouseenter="playChime('hover')" onclick="go('LOBBY')"
        class="float-link font-eerie text-2xl tracking-[0.16em]">
        Return to Lobby
      </button>
    </div>
  `;
}

/* ============================================================================
   DRIFTING MIST & FINE RAIN ATMOSPHERE CANVAS
============================================================================ */
function initAtmosphere() {
  const canvas = document.getElementById('atmosphere-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let w = canvas.width = window.innerWidth;
  let h = canvas.height = window.innerHeight;

  const drops = Array.from({ length: 55 }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    len: Math.random() * 14 + 6,
    vy: Math.random() * 2.2 + 1.4,
    vx: -0.35,
    alpha: Math.random() * 0.18 + 0.05
  }));

  const fogWisps = Array.from({ length: 8 }, () => ({
    x: Math.random() * w,
    y: h * (0.45 + Math.random() * 0.45),
    r: Math.random() * 220 + 140,
    vx: (Math.random() - 0.5) * 0.25,
    alpha: Math.random() * 0.06 + 0.02
  }));

  window.addEventListener('resize', () => {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  });

  function loop() {
    ctx.clearRect(0, 0, w, h);

    for (const f of fogWisps) {
      f.x += f.vx;
      if (f.x < -f.r) f.x = w + f.r;
      if (f.x > w + f.r) f.x = -f.r;

      const grad = ctx.createRadialGradient(f.x, f.y, 10, f.x, f.y, f.r);
      grad.addColorStop(0, `rgba(110, 148, 184, ${f.alpha})`);
      grad.addColorStop(1, 'rgba(9, 19, 36, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.lineWidth = 1;
    for (const d of drops) {
      d.x += d.vx;
      d.y += d.vy;
      if (d.y > h) {
        d.y = -20;
        d.x = Math.random() * w;
      }
      ctx.strokeStyle = `rgba(175, 202, 232, ${d.alpha})`;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x + d.vx * 3, d.y + d.len);
      ctx.stroke();
    }

    requestAnimationFrame(loop);
  }
  loop();
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.screen !== 'MENU') {
    go('MENU');
  }
});

window.createLobby = createLobby;
window.confirmJoin = confirmJoin;
window.go = go;
window.copyCode = copyCode;
window.toggleReady = toggleReady;
window.beginMatch = beginMatch;
window.kickPlayer = kickPlayer;
window.updatePlayerName = updatePlayerName;
window.playChime = playChime;

function startApp() {
  initAtmosphere();
  render();
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}
