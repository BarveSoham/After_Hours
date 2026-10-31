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

    // Channeling & Hunter state
    this.isChanneling = false;
    this.channelProgress = 0;
    this.channelDuration = 2500;
    this.canAttack = true;
    this.attackCooldownTimer = 0;
    this.attackCooldownDuration = 1200;

    // Environment & Obstacles
    this.obstacles = this.physics.add.staticGroup();
    this.createSolidRoom();

    // Exit Gate
    this.exitDoor = this.add.rectangle(740, 80, 60, 60, 0x444444);
    this.exitDoorText = this.add.text(740, 80, 'EXIT\n[LOCKED]', {
      fontSize: '11px',
      fontFamily: 'monospace',
      align: 'center',
      color: '#ff4444'
    }).setOrigin(0.5);

    // Keycard Terminal
    this.keycardSprite = this.add.rectangle(0, 0, 24, 16, 0xf1c40f).setVisible(false);
    this.interactionPrompt = this.add.text(0, 0, 'Hold [E] to Bypass', {
      fontSize: '11px',
      fontFamily: 'monospace',
      backgroundColor: '#000000cc',
      padding: { x: 5, y: 3 }
    }).setOrigin(0.5).setVisible(false).setDepth(25);

    // Local Player Sprite
    this.player = this.add.rectangle(400, 300, 36, 36, 0x888888);
    this.physics.add.existing(this.player);
    this.player.body.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, this.obstacles);

    // Attack click
    this.input.on('pointerdown', (pointer) => {
      if (pointer.leftButtonDown() && this.role === 'hunter' && this.isMatchActive && this.canAttack) {
        this.canAttack = false;
        this.attackCooldownTimer = this.attackCooldownDuration;
        this.socket.emit('hunterAttack');
        this.cameras.main.shake(80, 0.005);
      }
    });

    // Darkness & Flashlight
    this.darkness = this.add.renderTexture(0, 0, 800, 600).setDepth(10);
    this.createFlashlightGraphic();

    // Modular Subsystems
    this.playerController = new PlayerController(this);
    this.ui = new UIManager(this);
    this.network = new NetworkManager(this);
  }

  createSolidRoom() {
    const roomData = [
      { x: 200, y: 180, w: 80, h: 40, color: 0x8e44ad },
      { x: 620, y: 220, w: 50, h: 80, color: 0xe67e22 },
      { x: 250, y: 480, w: 90, h: 40, color: 0x95a5a6 },
      { x: 420, y: 320, w: 24, h: 120, color: 0x555555 }
    ];

    roomData.forEach((data) => {
      const block = this.add.rectangle(data.x, data.y, data.w, data.h, data.color);
      this.physics.add.existing(block, true);
      this.obstacles.add(block);
    });
  }

  createFlashlightGraphic() {
    this.lightMask = this.make.graphics({ x: 0, y: 0, add: false });
    this.lightMask.fillStyle(0xffffff, 1.0);
    this.lightMask.fillCircle(0, 0, 45);

    const range = 260;
    const halfAngle = Phaser.Math.DegToRad(25);
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
    other.targetX = playerInfo.x;
    other.targetY = playerInfo.y;
    this.otherPlayers.add(other);
  }

  update(time, delta) {
    const dt = delta / 1000;

    // Cooldown timer
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
      this.darkness.fill(0x050508, 0.4);
      return;
    }

    // --- Channeling Logic ---
    if (this.keycardSprite.visible && this.role === 'survivor') {
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.keycardSprite.x, this.keycardSprite.y);
      const isMoving = this.player.body.velocity.length() > 5;

      if (dist < 55) {
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

    // Subsystem updates
    this.playerController.update(dt, this.isChanneling);

    // Escape gate touch
    if (this.taskCompleted && !this.hasEscaped && this.role === 'survivor') {
      const distToDoor = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.exitDoor.x, this.exitDoor.y);
      if (distToDoor < 45) {
        this.socket.emit('playerEscaped');
      }
    }

    // Network Sync
    const pointer = this.input.activePointer;
    const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, pointer.x, pointer.y);
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

    // Darkness & Flashlight
    this.darkness.clear();
    if (this.role === 'hunter') {
      this.darkness.fill(0x3a0007, 0.25);
    } else {
      this.darkness.fill(0x050508, 0.98);
      this.lightMask.setAngle(deg);
      this.darkness.erase(this.lightMask, this.player.x, this.player.y);
    }

    this.ui.update(dt, this.playerController);
  }
}

const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  parent: 'game-container',
  physics: {
    default: 'arcade',
    arcade: { gravity: { y: 0 } }
  },
  scene: MainScene
};

new Phaser.Game(config);