import Phaser from 'phaser';
import { io } from 'socket.io-client';
import { PlayerController } from './player.js';
import { UIManager } from './ui.js';
import { NetworkManager } from './network.js';

class MainScene extends Phaser.Scene {
  constructor() {
    super('MainScene');
  }

  create() {
    this.socket = io(); // Automatically connects to the host's tunnel
    this.otherPlayers = this.add.group();
    this.footprintsGroup = this.add.group();

    this.role = 'waiting';
    this.isAlive = true;
    this.hasEscaped = false;
    this.taskCompleted = false;
    this.isMatchActive = false;

    this.spectateIndex = 0;
    this.spectateTarget = null;

    this.isChanneling = false;
    this.channelProgress = 0;
    this.channelDuration = 1250; // 1.25s channel time
    this.canAttack = true;
    this.attackCooldownTimer = 0;
    this.attackCooldownDuration = 1200;

    // 1. World Bounds
    this.physics.world.setBounds(0, 0, 2000, 1500);
    const floor = this.add.grid(1000, 750, 2000, 1500, 64, 64, 0x141419, 1, 0x1d1d24, 0.6).setDepth(-1);

    // 2. Obstacles (Central Ring Layout)
    this.obstacles = this.physics.add.staticGroup();
    this.createFacilityWalls();

    // 3. Exit Door (East Chamber)
    this.exitDoor = this.add.rectangle(1840, 750, 60, 120, 0x444444);
    this.exitDoorText = this.add.text(1840, 750, 'EXIT\n[LOCKED]', {
      fontSize: '12px',
      fontFamily: 'monospace',
      align: 'center',
      color: '#ff4444'
    }).setOrigin(0.5);

    // 4. Terminal
    this.keycardSprite = this.add.rectangle(0, 0, 26, 18, 0xf1c40f).setVisible(false);
    this.interactionPrompt = this.add.text(0, 0, 'Hold [E] to Bypass', {
      fontSize: '11px',
      fontFamily: 'monospace',
      backgroundColor: '#000000cc',
      padding: { x: 5, y: 3 }
    }).setOrigin(0.5).setVisible(false).setDepth(25);

    // 5. Player
    this.player = this.add.rectangle(1000, 750, 36, 36, 0x888888);
    this.physics.add.existing(this.player);
    this.player.body.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, this.obstacles);

    // 6. Camera
    this.cameras.main.setBounds(0, 0, 2000, 1500);
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);

    // 7. Darkness
    this.darkness = this.add.renderTexture(0, 0, 1280, 720).setDepth(10).setScrollFactor(0);
    this.createFlashlightGraphic();

    // 8. Systems
    this.playerController = new PlayerController(this);
    this.ui = new UIManager(this);
    this.network = new NetworkManager(this);

    // 9. Hunter attack click
    this.input.on('pointerdown', (pointer) => {
      if (this.ui.isGameOverVisible) return;

      if (this.role === 'hunter' && this.isMatchActive && this.canAttack) {
        this.canAttack = false;
        this.attackCooldownTimer = this.attackCooldownDuration;
        this.socket.emit('hunterAttack');
        this.cameras.main.shake(80, 0.005);
      } else if (!this.isAlive || this.hasEscaped) {
        this.cycleSpectateTarget();
      }
    });

    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    // 10. Wire HTML & Return-to-Lobby controls
    this.setupHTMLMenuBindings();
  }

  returnToLobby() {
    this.isMatchActive = false;
    this.player.body.setVelocity(0);
    this.ui.hideGameOver();
    this.ui.heartbeatVignette.clear();

    const menuLayer = document.getElementById('menu-layer');
    const inGameLobbyBtn = document.getElementById('btnInGameLobbyReturn');

    if (inGameLobbyBtn) inGameLobbyBtn.classList.add('hidden');
    if (menuLayer) {
      menuLayer.style.opacity = '1';
      menuLayer.style.pointerEvents = 'auto';
    }

    const modalLobby = document.getElementById('modalLobby');
    if (modalLobby) {
      modalLobby.classList.remove('hidden');
      setTimeout(() => modalLobby.classList.remove('opacity-0'), 10);
    }
  }

  setupHTMLMenuBindings() {
    const btnPlayMain = document.getElementById('btnPlayMain');
    const btnOpenCodex = document.getElementById('btnOpenCodex');
    const btnOpenSettings = document.getElementById('btnOpenSettings');
    const btnGenRoom = document.getElementById('btnGenRoom');
    const btnJoinRoom = document.getElementById('btnJoinRoom');
    const btnToggleReady = document.getElementById('btnToggleReady');
    const btnCommenceWoods = document.getElementById('btnCommenceWoods');
    const btnInGameLobbyReturn = document.getElementById('btnInGameLobbyReturn');
    const inputWandererName = document.getElementById('inputWandererName');
    const inputRoomCode = document.getElementById('inputRoomCode');
    const rosterContainer = document.getElementById('rosterContainer');
    const slotPlayerCount = document.getElementById('slotPlayerCount');
    const menuLayer = document.getElementById('menu-layer');
    const descentOverlay = document.getElementById('descentOverlay');

    const openModal = (id) => {
      const el = document.getElementById(id);
      if (el) {
        el.classList.remove('hidden');
        setTimeout(() => el.classList.remove('opacity-0'), 10);
      }
    };

    const closeModal = (id) => {
      const el = document.getElementById(id);
      if (el) {
        el.classList.add('opacity-0');
        setTimeout(() => el.classList.add('hidden'), 300);
      }
    };

    btnPlayMain?.addEventListener('click', () => openModal('modalLobby'));
    btnOpenCodex?.addEventListener('click', () => openModal('modalCodex'));
    btnOpenSettings?.addEventListener('click', () => openModal('modalSettings'));

    btnInGameLobbyReturn?.addEventListener('click', () => {
      this.returnToLobby();
    });

    document.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', () => closeModal(btn.getAttribute('data-target')));
    });

    btnGenRoom?.addEventListener('click', () => {
      const prefixes = ['WOODS', 'MIST', 'BRAMBLE', 'RAVEN', 'CURSE'];
      const p = prefixes[Math.floor(Math.random() * prefixes.length)];
      const n = Math.floor(Math.random() * 89 + 10);
      inputRoomCode.value = `${p}-${n}`;
    });

    btnJoinRoom?.addEventListener('click', () => {
      const name = inputWandererName.value.trim() || 'Lost_Seeker';
      const room = inputRoomCode.value.trim().toUpperCase() || 'WOODS-1';
      this.socket.emit('joinRoom', { name, roomCode: room });
    });

    btnToggleReady?.addEventListener('click', () => {
      this.socket.emit('toggleReady');
    });

    btnCommenceWoods?.addEventListener('click', () => {
      this.socket.emit('startMatchRequest');
    });

    this.socket.on('lobbyRosterUpdate', (data) => {
      if (slotPlayerCount) slotPlayerCount.textContent = data.players.length;
      if (rosterContainer) {
        rosterContainer.innerHTML = '';
        data.players.forEach((p, idx) => {
          const isHost = (p.id === data.hostId);
          const card = document.createElement('div');
          card.className = "flex items-center justify-between p-3 bg-[#02090b] border border-teal-900/60 hover:border-teal-700/80 rounded-xl transition";
          card.innerHTML = `
            <div class="flex items-center space-x-3">
              <span class="w-3 h-3 rounded-full ${p.ready ? 'bg-[#4fffe3] shadow-[0_0_10px_#4fffe3]' : 'bg-amber-400'}"></span>
              <div>
                <div class="flex items-center space-x-2">
                  <span class="font-codex text-sm text-white font-bold">${p.name}</span>
                  ${isHost ? '<span class="text-[9px] font-cinzel px-2 py-0.5 bg-teal-950 text-[#4fffe3] border border-teal-700/60 rounded uppercase font-bold">HOST</span>' : ''}
                </div>
                <span class="text-[10px] font-cinzel text-slate-500">CHAMBER SEAT 0${idx + 1}</span>
              </div>
            </div>
            <span class="font-codex text-xs font-bold px-3 py-1 rounded-md ${p.ready ? 'bg-teal-950/80 text-[#4fffe3] border border-teal-800/80' : 'bg-amber-950/40 text-amber-400 border border-amber-900/40'}">
              ${p.ready ? 'READY' : 'PREPARING'}
            </span>
          `;
          rosterContainer.appendChild(card);
        });
      }
    });

    this.socket.on('matchStarted', () => {
      closeModal('modalLobby');
      descentOverlay?.classList.remove('opacity-0', 'pointer-events-none');

      setTimeout(() => {
        if (menuLayer) {
          menuLayer.style.opacity = '0';
          menuLayer.style.pointerEvents = 'none';
        }
        if (btnInGameLobbyReturn) {
          btnInGameLobbyReturn.classList.remove('hidden');
        }
        descentOverlay?.classList.add('opacity-0', 'pointer-events-none');
      }, 1400);
    });

    this.socket.emit('joinRoom', { name: 'Lost_Seeker', roomCode: 'WOODS-1' });
  }

  cycleSpectateTarget() {
    const candidates = this.otherPlayers.getChildren().filter(p => p.visible && p.isAlive !== false);
    if (candidates.length === 0) return;

    this.spectateIndex = (this.spectateIndex + 1) % candidates.length;
    this.spectateTarget = candidates[this.spectateIndex];

    if (this.spectateTarget) {
      this.cameras.main.startFollow(this.spectateTarget, true, 0.1, 0.1);
      const roleName = this.spectateTarget.playerRole ? this.spectateTarget.playerRole.toUpperCase() : 'PLAYER';
      this.ui.spectatorBanner.setText(`SPECTATING: ${roleName}`);
    }
  }

  createFacilityWalls() {
    const addWall = (x, y, w, h, color = 0x33333d) => {
      const rect = this.add.rectangle(x, y, w, h, color);
      this.physics.add.existing(rect, true);
      this.obstacles.add(rect);
    };

    // 1. OUTER PERIMETER BOUNDARY WALLS
    addWall(1000, 10, 2000, 20);
    addWall(1000, 1490, 2000, 20);
    addWall(10, 750, 20, 1500);
    addWall(1990, 750, 20, 1500);

    // 2. THE BIG CENTRAL ROOM (x: 600..1400, y: 450..1050)
    addWall(765, 450, 330, 20);
    addWall(1235, 450, 330, 20);
    addWall(765, 1050, 330, 20);
    addWall(1235, 1050, 330, 20);
    addWall(600, 565, 20, 230);
    addWall(600, 935, 20, 230);
    addWall(1400, 565, 20, 230);
    addWall(1400, 935, 20, 230);

    // 3. SURROUNDING OUTER PARTITION WALLS
    addWall(120, 450, 220, 20);
    addWall(485, 450, 230, 20);
    addWall(1515, 450, 230, 20);
    addWall(1880, 450, 220, 20);
    addWall(120, 1050, 220, 20);
    addWall(485, 1050, 230, 20);
    addWall(1515, 1050, 230, 20);
    addWall(1880, 1050, 220, 20);
    addWall(600, 100, 20, 180);
    addWall(600, 380, 20, 140);
    addWall(1400, 100, 20, 180);
    addWall(1400, 380, 20, 140);
    addWall(600, 1120, 20, 140);
    addWall(600, 1400, 20, 180);
    addWall(1400, 1120, 20, 140);
    addWall(1400, 1400, 20, 180);

    // 4. COVER COLUMNS IN THE BIG CENTRAL ROOM
    addWall(850, 650, 50, 50, 0x4f4f5c);
    addWall(1150, 650, 50, 50, 0x4f4f5c);
    addWall(850, 850, 50, 50, 0x4f4f5c);
    addWall(1150, 850, 50, 50, 0x4f4f5c);
  }

  createFlashlightGraphic() {
    this.lightMask = this.make.graphics({ x: 0, y: 0, add: false });
    this.lightMask.fillStyle(0xffffff, 1.0);
    this.lightMask.fillCircle(0, 0, 50);

    const range = 280;
    const halfAngle = Phaser.Math.DegToRad(26);
    this.lightMask.beginPath();
    this.lightMask.moveTo(0, 0);
    this.lightMask.arc(0, 0, range, -halfAngle, halfAngle);
    this.lightMask.closePath();
    this.lightMask.fillPath();
  }

  addOtherPlayer(playerInfo) {
    const isHunter = (playerInfo.role === 'hunter');
    const color = isHunter ? 0xe74c3c : (playerInfo.alive ? 0x3498db : 0x444444);
    
    const other = this.add.rectangle(playerInfo.x, playerInfo.y, 36, 36, color).setDepth(5);
    other.playerId = playerInfo.id;
    other.playerRole = playerInfo.role;
    other.isAlive = playerInfo.alive !== false;
    other.targetX = playerInfo.x;
    other.targetY = playerInfo.y;
    this.otherPlayers.add(other);
  }

  update(time, delta) {
    const dt = delta / 1000;

    if (!this.canAttack) {
      this.attackCooldownTimer -= delta;
      if (this.attackCooldownTimer <= 0) {
        this.canAttack = true;
        this.attackCooldownTimer = 0;
      }
    }

    if (!this.isMatchActive) {
      this.player.body.setVelocity(0);
      this.darkness.clear();
      this.darkness.fill(0x0a0a10, 0.4);
      return;
    }

    if (!this.isAlive || this.hasEscaped) {
      this.player.body.setVelocity(0);
      this.darkness.clear();
      this.darkness.fill(0x050508, 0.15);

      if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
        this.cycleSpectateTarget();
      }

      this.playerController.update(dt, true);
      this.ui.update(dt, this.playerController);
      return;
    }

    if (this.keycardSprite.visible && this.role === 'survivor') {
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.keycardSprite.x, this.keycardSprite.y);
      const isMoving = this.player.body.velocity.length() > 5;

      if (dist < 60) {
        this.interactionPrompt.setVisible(true);

        if (this.playerController.interactKey.isDown && !isMoving) {
          if (!this.isChanneling) {
            this.isChanneling = true;
            this.channelProgress = 0;
            this.socket.emit('startChanneling');
          }

          this.channelProgress += delta;
          const ratio = Math.min(1, this.channelProgress / this.channelDuration);
          this.ui.setChannelProgress(true, ratio, this.player.x, this.player.y);

          if (this.channelProgress >= this.channelDuration) {
            this.socket.emit('finishChanneling');
          }
        } else {
          if (this.isChanneling) {
            this.isChanneling = false;
            this.channelProgress = 0;
            this.ui.setChannelProgress(false);
            this.socket.emit('cancelChanneling');
          }
        }
      } else {
        this.interactionPrompt.setVisible(false);
        if (this.isChanneling) {
          this.isChanneling = false;
          this.channelProgress = 0;
          this.ui.setChannelProgress(false);
          this.socket.emit('cancelChanneling');
        }
      }
    }

    this.playerController.update(dt, this.isChanneling);

    if (this.taskCompleted && !this.hasEscaped && this.role === 'survivor') {
      const distToDoor = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.exitDoor.x, this.exitDoor.y);
      if (distToDoor < 65) {
        this.socket.emit('playerEscaped');
      }
    }

    const pointer = this.input.activePointer;
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, worldPoint.x, worldPoint.y);
    const deg = Phaser.Math.RadToDeg(angle);

    if (this.player.oldPosition && (
      this.player.x !== this.player.oldPosition.x ||
      this.player.y !== this.player.oldPosition.y ||
      deg !== this.player.oldPosition.angle ||
      this.playerController.isSprinting !== this.player.oldPosition.isSprinting
    )) {
      this.network.sendMovement(this.player.x, this.player.y, deg, this.playerController.isSprinting);
    }
    this.player.oldPosition = { x: this.player.x, y: this.player.y, angle: deg, isSprinting: this.playerController.isSprinting };

    this.darkness.clear();
    if (this.role === 'hunter') {
      this.darkness.fill(0x3a0007, 0.25);
    } else {
      this.darkness.fill(0x050508, 0.98);
      this.lightMask.setAngle(deg);
      const screenX = this.player.x - this.cameras.main.scrollX;
      const screenY = this.player.y - this.cameras.main.scrollY;
      this.darkness.erase(this.lightMask, screenX, screenY);
    }

    this.ui.update(dt, this.playerController);
  }
}

const config = {
  type: Phaser.AUTO,
  parent: 'game-container',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1280,
    height: 720
  },
  physics: {
    default: 'arcade',
    arcade: { gravity: { y: 0 } }
  },
  scene: MainScene
};

new Phaser.Game(config);