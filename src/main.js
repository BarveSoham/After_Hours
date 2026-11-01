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
    this.socket = io('http://localhost:3000');
    this.otherPlayers = this.add.group();
    this.footprintsGroup = this.add.group();

    this.role = 'waiting';
    this.isAlive = true;
    this.hasEscaped = false;
    this.taskCompleted = false;
    this.isMatchActive = false;

    // Spectator Target System
    this.spectateIndex = 0;
    this.spectateTarget = null;

    // Channeling & Attack Cooldown
    this.isChanneling = false;
    this.channelProgress = 0;
    this.channelDuration = 2500;
    this.canAttack = true;
    this.attackCooldownTimer = 0;
    this.attackCooldownDuration = 1200;

    // 1. World Bounds
    this.physics.world.setBounds(0, 0, 2000, 1500);

    // 2. Floor Grid Ground
    const floor = this.add.grid(1000, 750, 2000, 1500, 64, 64, 0x141419, 1, 0x1d1d24, 0.6);
    floor.setDepth(-1);

    // 3. Facility Walls
    this.obstacles = this.physics.add.staticGroup();
    this.createFacilityWalls();

    // 4. East Wing Exit Gate
    this.exitDoor = this.add.rectangle(1880, 750, 60, 120, 0x444444);
    this.exitDoorText = this.add.text(1880, 750, 'EXIT\n[LOCKED]', {
      fontSize: '12px',
      fontFamily: 'monospace',
      align: 'center',
      color: '#ff4444'
    }).setOrigin(0.5);

    // 5. Keycard Terminal
    this.keycardSprite = this.add.rectangle(0, 0, 26, 18, 0xf1c40f).setVisible(false);
    this.interactionPrompt = this.add.text(0, 0, 'Hold [E] to Bypass', {
      fontSize: '11px',
      fontFamily: 'monospace',
      backgroundColor: '#000000cc',
      padding: { x: 5, y: 3 }
    }).setOrigin(0.5).setVisible(false).setDepth(25);

    // 6. Local Player
    this.player = this.add.rectangle(1000, 750, 36, 36, 0x888888);
    this.physics.add.existing(this.player);
    this.player.body.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, this.obstacles);

    // 7. Camera Follow
    this.cameras.main.setBounds(0, 0, 2000, 1500);
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);

    // 8. Darkness Screen Overlay
    this.darkness = this.add.renderTexture(0, 0, 1280, 720).setDepth(10).setScrollFactor(0);
    this.createFlashlightGraphic();

    // 9. Subsystems
    this.playerController = new PlayerController(this);
    this.ui = new UIManager(this);
    this.network = new NetworkManager(this);

    // 10. Direct Hunter Attack Input & Spectator Click Trigger
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

    this.scale.on('resize', this.handleResize, this);
  }

  handleResize(gameSize) {
    if (this.darkness) {
      this.darkness.resize(gameSize.width, gameSize.height);
    }
  }

  cycleSpectateTarget() {
    // Collect all valid remote players who are currently alive and visible
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

    addWall(1000, 10, 2000, 20);
    addWall(1000, 1490, 2000, 20);
    addWall(10, 750, 20, 1500);
    addWall(1990, 750, 20, 1500);

    // West Wing Classroom A
    addWall(550, 200, 20, 360);
    addWall(550, 650, 20, 260);
    addWall(240, 750, 440, 20);

    // West Wing Classroom B
    addWall(550, 850, 20, 260);
    addWall(550, 1300, 20, 360);

    // North Science Lab
    addWall(750, 500, 380, 20);
    addWall(1350, 500, 540, 20);
    addWall(1100, 260, 20, 260);

    // South Storage Bay
    addWall(750, 1000, 380, 20);
    addWall(1350, 1000, 540, 20);
    addWall(900, 1260, 20, 440);

    // East Corridor
    addWall(1550, 350, 20, 660);
    addWall(1550, 1150, 20, 660);

    // Cover Columns
    addWall(850, 750, 60, 60, 0x4f4f5c);
    addWall(1250, 750, 60, 60, 0x4f4f5c);
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
    const color = playerInfo.role === 'hunter' ? 0xe74c3c : (playerInfo.alive ? 0x3498db : 0x444444);
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

    // --- Spectator Mode ---
    if (!this.isAlive || this.hasEscaped) {
      this.player.body.setVelocity(0);
      
      this.darkness.clear();
      this.darkness.fill(0x050508, 0.15);

      // Check space bar input reliably in update loop
      if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
        this.cycleSpectateTarget();
      }

      this.playerController.update(dt, true);
      this.ui.update(dt, this.playerController);
      return;
    }

    // --- Active Survivor Channeling ---
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

    // Escape check
    if (this.taskCompleted && !this.hasEscaped && this.role === 'survivor') {
      const distToDoor = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.exitDoor.x, this.exitDoor.y);
      if (distToDoor < 65) {
        this.socket.emit('playerEscaped');
      }
    }

    // Aiming calculation
    const pointer = this.input.activePointer;
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, worldPoint.x, worldPoint.y);
    const deg = Phaser.Math.RadToDeg(angle);

    // Network Sync
    if (this.player.oldPosition && (
      this.player.x !== this.player.oldPosition.x ||
      this.player.y !== this.player.oldPosition.y ||
      deg !== this.player.oldPosition.angle ||
      this.playerController.isSprinting !== this.player.oldPosition.isSprinting
    )) {
      this.network.sendMovement(this.player.x, this.player.y, deg, this.playerController.isSprinting);
    }
    this.player.oldPosition = { x: this.player.x, y: this.player.y, angle: deg, isSprinting: this.playerController.isSprinting };

    // Darkness & Flashlight
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