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
    this.socket.on('connect', () => {
      console.log(`[Socket.io] Connected to server! Socket ID: ${this.socket.id}`);
    });
    this.socket.on('connect_error', (err) => {
      console.error('[Socket.io] Connection error:', err.message);
    });
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

    // Network Sync Throttle (~30Hz)
    this.networkTickTimer = 0;
    this.networkTickInterval = 33;

    // 1. World Bounds
    this.physics.world.setBounds(0, 0, 2000, 1500);
    const floor = this.add.grid(1000, 750, 2000, 1500, 64, 64, 0x141419, 1, 0x1d1d24, 0.6).setDepth(-1);

    // 2. Obstacles (Central Ring Layout)
    this.obstacles = this.physics.add.staticGroup();
    this.createFacilityWalls();

    // 3. Dynamic Exit Doors (stored in activeDoors and populated on match start)
    this.activeDoors = [];
    this.isPaused = false;

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

    // 7. Darkness (full-screen 1280x720 overlay anchored to top-left)
    this.darkness = this.add.renderTexture(0, 0, 1280, 720).setOrigin(0, 0).setDepth(10).setScrollFactor(0);
    this.createFlashlightGraphic();

    // 8. Systems
    this.playerController = new PlayerController(this);
    this.ui = new UIManager(this);
    this.network = new NetworkManager(this);

    // 9. Hunter attack click
    this.input.on('pointerdown', (pointer) => {
      if (this.ui.isGameOverVisible || this.isPaused) return;

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
    this.escKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);

    // 10. Wire HTML & Return-to-Lobby controls
    this.setupHTMLMenuBindings();
  }

  setInGameCursor(visible) {
    const style = visible ? 'default' : 'none';
    if (this.game && this.game.canvas) {
      this.game.canvas.style.cursor = style;
    }
    const container = document.getElementById('game-container');
    if (container) {
      container.style.cursor = style;
    }
  }

  togglePause(forceState) {
    if (!this.isMatchActive || this.ui.isGameOverVisible) return;
    this.isPaused = (forceState !== undefined) ? forceState : !this.isPaused;

    if (this.isPaused) {
      if (this.isChanneling) {
        this.isChanneling = false;
        this.channelProgress = 0;
        this.ui.setChannelProgress(false);
        this.socket.emit('cancelChanneling');
      }
      this.player.body.setVelocity(0);
      this.ui.showPause();
      this.setInGameCursor(true);
    } else {
      this.ui.hidePause();
      this.setInGameCursor(false);
    }
  }

  returnToLobby() {
    this.isMatchActive = false;
    this.isPaused = false;
    this.ui.hidePause();
    this.setInGameCursor(true);
    this.player.body.setVelocity(0);
    this.ui.hideGameOver();
    this.ui.heartbeatVignette.clear();
    window.location.href = '/mainscreen/index.html';
  }

  setupHTMLMenuBindings() {
    // Support URL parameters (?room=XYZ&name=MyName)
    const urlParams = new URLSearchParams(window.location.search);
    const initialName = urlParams.get('name') || localStorage.getItem('afterHoursPlayerName') || 'Wanderer';
    const initialRoom = (urlParams.get('room') || 'AFH-409').toUpperCase();

    this.socket.emit('joinRoom', { name: initialName, roomCode: initialRoom });
  }

  cycleSpectateTarget() {
    const candidates = this.otherPlayers.getChildren().filter(p => p.visible && p.isAlive !== false);
    if (candidates.length === 0) return;

    this.spectateIndex = (this.spectateIndex + 1) % candidates.length;
    this.spectateTarget = candidates[this.spectateIndex];

    if (this.spectateTarget) {
      // Direct follow eliminates dual-lerp oscillation with remote player interpolation
      this.cameras.main.startFollow(this.spectateTarget, true, 1.0, 1.0);
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

    // 1. Soft outer ambient aura around player
    this.lightMask.fillStyle(0xffffff, 0.45);
    this.lightMask.fillCircle(0, 0, 115);

    // 2. Clear personal light circle around player
    this.lightMask.fillStyle(0xffffff, 1.0);
    this.lightMask.fillCircle(0, 0, 80);

    // 3. Expanded directional flashlight beam (wider & longer reach)
    const range = 360;
    const halfAngle = Phaser.Math.DegToRad(32);
    this.lightMask.beginPath();
    this.lightMask.moveTo(0, 0);
    this.lightMask.arc(0, 0, range, -halfAngle, halfAngle);
    this.lightMask.closePath();
    this.lightMask.fillPath();

    // 4. Emergency beacon light circle for powered exit gates
    this.doorLightGraphic = this.make.graphics({ add: false });
    this.doorLightGraphic.fillStyle(0xffffff, 0.95);
    this.doorLightGraphic.fillCircle(0, 0, 160);
  }

  addOtherPlayer(playerInfo) {
    if (!playerInfo || playerInfo.id === this.socket.id) return;

    // Clean up any existing otherPlayer with the same ID or name
    this.otherPlayers.getChildren().forEach((other) => {
      if (other.playerId === playerInfo.id || (playerInfo.name && other.playerName === playerInfo.name)) {
        other.destroy();
      }
    });

    const isHunter = (playerInfo.role === 'hunter');
    const color = isHunter ? 0xe74c3c : (playerInfo.alive !== false ? 0x3498db : 0x444444);
    
    const other = this.add.rectangle(playerInfo.x, playerInfo.y, 36, 36, color).setDepth(5);
    other.playerId = playerInfo.id;
    other.playerName = playerInfo.name;
    other.playerRole = playerInfo.role;
    other.isAlive = playerInfo.alive !== false;
    other.targetX = playerInfo.x;
    other.targetY = playerInfo.y;
    this.otherPlayers.add(other);
  }

  update(time, delta) {
    const dt = delta / 1000;

    // Toggle pause with ESC key during active match
    if (this.isMatchActive && !this.ui.isGameOverVisible && Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.togglePause();
    }

    if (this.isPaused) {
      this.player.body.setVelocity(0);
      this.playerController.update(dt, true);
      this.ui.update(dt, this.playerController);
      return;
    }

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
      const isTryingToMove = (
        this.playerController.wasd.left.isDown ||
        this.playerController.wasd.right.isDown ||
        this.playerController.wasd.up.isDown ||
        this.playerController.wasd.down.isDown ||
        this.player.body.velocity.length() > 25
      );

      if (dist < 75) {
        this.interactionPrompt.setVisible(true);

        if (this.playerController.interactKey.isDown && !isTryingToMove) {
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

    // Escape check against ANY active dynamic exit door (generous 95px radius)
    if (this.taskCompleted && !this.hasEscaped && this.role === 'survivor' && this.activeDoors && this.activeDoors.length > 0) {
      const reachedDoor = this.activeDoors.some(door => {
        return Phaser.Math.Distance.Between(this.player.x, this.player.y, door.x, door.y) < 95;
      });
      if (reachedDoor) {
        this.socket.emit('playerEscaped');
      }
    }

    const pointer = this.input.activePointer;
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, worldPoint.x, worldPoint.y);
    const deg = Phaser.Math.RadToDeg(angle);

    // Network Sync throttled to 30Hz (~33ms)
    this.networkTickTimer += delta;
    if (this.networkTickTimer >= this.networkTickInterval) {
      this.networkTickTimer = 0;
      if (this.player.oldPosition && (
        Math.abs(this.player.x - this.player.oldPosition.x) > 0.5 ||
        Math.abs(this.player.y - this.player.oldPosition.y) > 0.5 ||
        Math.abs(deg - this.player.oldPosition.angle) > 0.5 ||
        this.playerController.isSprinting !== this.player.oldPosition.isSprinting
      )) {
        this.network.sendMovement(this.player.x, this.player.y, deg, this.playerController.isSprinting);
        this.player.oldPosition = { x: this.player.x, y: this.player.y, angle: deg, isSprinting: this.playerController.isSprinting };
      }
    }
    if (!this.player.oldPosition) {
      this.player.oldPosition = { x: this.player.x, y: this.player.y, angle: deg, isSprinting: this.playerController.isSprinting };
    }

    this.darkness.clear();
    if (this.role === 'hunter') {
      this.darkness.fill(0x3a0007, 0.25);
    } else {
      // Atmospheric darkness (0.88 allows faint perception of wall silhouettes)
      this.darkness.fill(0x050508, 0.88);
      this.lightMask.setAngle(deg);
      const screenX = this.player.x - this.cameras.main.scrollX;
      const screenY = this.player.y - this.cameras.main.scrollY;
      this.darkness.erase(this.lightMask, screenX, screenY);

      // Cut emergency beacon light through the darkness at each powered exit door
      if (this.taskCompleted && this.activeDoors && this.activeDoors.length > 0 && this.doorLightGraphic) {
        this.activeDoors.forEach(door => {
          const doorScreenX = door.x - this.cameras.main.scrollX;
          const doorScreenY = door.y - this.cameras.main.scrollY;
          this.darkness.erase(this.doorLightGraphic, doorScreenX, doorScreenY);
        });
      }
    }

    this.ui.update(dt, this.playerController);
  }
}

const config = {
  type: Phaser.AUTO,
  parent: 'game-container',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.NO_CENTER,
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