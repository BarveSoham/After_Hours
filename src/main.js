import Phaser from 'phaser';
import { io } from 'socket.io-client';

class MainScene extends Phaser.Scene {
  constructor() {
    super('MainScene');
  }

  create() {
    this.socket = io('http://localhost:3000');
    this.otherPlayers = this.add.group();

    this.role = 'waiting';
    this.hasKeycard = false;
    this.hasEscaped = false;
    this.isMatchActive = false;

    // 1. Room obstacles
    this.obstacles = this.physics.add.staticGroup();
    this.createSolidRoom();

    // 2. Exit Door
    this.exitDoor = this.add.rectangle(740, 80, 60, 60, 0x444444);
    this.exitDoorText = this.add.text(740, 80, 'LOCKED', {
      fontSize: '11px',
      fontFamily: 'monospace',
      color: '#ff4444'
    }).setOrigin(0.5);

    // 3. Keycard (hidden until match starts)
    this.keycardSprite = this.add.rectangle(550, 480, 24, 16, 0xf1c40f).setVisible(false);
    this.interactionPrompt = this.add.text(550, 445, 'Press E', {
      fontSize: '12px',
      fontFamily: 'monospace',
      backgroundColor: '#000000cc',
      padding: { x: 4, y: 2 }
    }).setOrigin(0.5).setVisible(false).setDepth(25);

    // 4. Local Player
    this.player = this.add.rectangle(400, 300, 36, 36, 0x888888);
    this.physics.add.existing(this.player);
    this.player.body.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, this.obstacles);

    // 5. Keyboard & Mouse Inputs
    this.wasd = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D
    });
    this.shiftKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.interactKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);

    this.input.on('pointerdown', (pointer) => {
      if (pointer.leftButtonDown() && this.role === 'hunter' && this.isMatchActive) {
        this.socket.emit('hunterAttack');
      }
    });

    this.walkSpeed = 180;
    this.sprintSpeed = 310;
    this.stamina = 100;
    this.maxStamina = 100;
    this.anxiety = 0;
    this.maxAnxiety = 100;
    this.isExhausted = false;

    // 6. Darkness & Flashlight
    this.darkness = this.add.renderTexture(0, 0, 800, 600).setDepth(10);
    this.createFlashlightGraphic();

    // 7. HUD & Game Over Overlay
    this.createHUD();
    this.createGameOverUI(); // <-- Placed right after HUD

    // 8. Socket Events
    this.setupSocketEvents();
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

  createHUD() {
    this.hud = this.add.graphics().setDepth(20);
    this.roleText = this.add.text(20, 15, 'WAITING FOR PLAYERS (1/3)...', {
      fontSize: '12px',
      color: '#f1c40f',
      fontFamily: 'monospace'
    }).setDepth(21);

    this.objectiveText = this.add.text(20, 35, 'Stand by in lobby', {
      fontSize: '11px',
      color: '#aaaaaa',
      fontFamily: 'monospace'
    }).setDepth(21);
  }

  // --- REPLAY UI CONTAINER ---
  createGameOverUI() {
    this.endContainer = this.add.container(400, 300).setDepth(50).setVisible(false);

    // Dim background
    const overlay = this.add.rectangle(0, 0, 800, 600, 0x000000, 0.85);

    // Banner message
    this.endBannerText = this.add.text(0, -60, '', {
      fontSize: '28px',
      fontFamily: 'monospace',
      fontStyle: 'bold'
    }).setOrigin(0.5);

    // Clickable button
    const btnBg = this.add.rectangle(0, 30, 200, 44, 0x27ae60)
      .setInteractive({ useHandCursor: true });

    const btnText = this.add.text(0, 30, 'PLAY AGAIN', {
      fontSize: '16px',
      fontFamily: 'monospace',
      fontStyle: 'bold',
      color: '#ffffff'
    }).setOrigin(0.5);

    // Button hover effects
    btnBg.on('pointerover', () => btnBg.setFillStyle(0x2ecc71));
    btnBg.on('pointerout', () => btnBg.setFillStyle(0x27ae60));

    // Button click: sends restart request to server
    btnBg.on('pointerdown', () => {
      this.socket.emit('requestRestart');
    });

    this.endContainer.add([overlay, this.endBannerText, btnBg, btnText]);
  }

  drawHUD() {
    this.hud.clear();
    if (this.role !== 'survivor' || !this.isMatchActive) return;

    // Stamina bar
    this.hud.fillStyle(0x222226, 0.8);
    this.hud.fillRect(20, 60, 140, 10);
    const stamColor = this.isExhausted ? 0xe74c3c : 0x2ecc71;
    this.hud.fillStyle(stamColor, 1.0);
    this.hud.fillRect(20, 60, (this.stamina / this.maxStamina) * 140, 10);

    // Anxiety bar
    this.hud.fillStyle(0x222226, 0.8);
    this.hud.fillRect(20, 78, 140, 10);
    const anxColor = this.anxiety > 75 ? 0xe74c3c : 0x9b59b6;
    this.hud.fillStyle(anxColor, 1.0);
    this.hud.fillRect(20, 78, (this.anxiety / this.maxAnxiety) * 140, 10);
  }

  setupSocketEvents() {
    // Lobby count updates
    this.socket.on('lobbyUpdate', (lobby) => {
      if (lobby.gameState === 'waiting') {
        this.isMatchActive = false;
        this.roleText.setText(`WAITING FOR PLAYERS (${lobby.count}/${lobby.required})...`).setColor('#f1c40f');
        this.objectiveText.setText('Stand by in lobby').setColor('#aaaaaa');
        this.player.setFillStyle(0x888888);
      }
    });

    // Match Start / Reset
    this.socket.on('matchStarted', (data) => {
      // 1. Hide the replay screen
      this.endContainer.setVisible(false);

      // 2. Reset Survivor states
      this.hasKeycard = false;
      this.hasEscaped = false;
      this.stamina = 100;
      this.anxiety = 0;
      this.isExhausted = false;

      // 3. Reset Exit Door visual
      this.exitDoor.setFillStyle(0x444444);
      this.exitDoorText.setText('LOCKED').setColor('#ff4444');

      // 4. Start match
      this.isMatchActive = true;
      this.keycardSprite.setVisible(true);

      // Clear old player sprites
      this.otherPlayers.clear(true, true);

      const myData = data.players[this.socket.id];
      this.role = myData.role;
      this.player.setPosition(myData.x, myData.y);

      if (this.role === 'hunter') {
        this.player.setFillStyle(0xe74c3c);
        this.roleText.setText('ROLE: THE HUNTER (Left-Click to Attack)').setColor('#e74c3c');
        this.objectiveText.setText('OBJECTIVE: Hunt down all survivors before they escape!').setColor('#ff4444');
        this.walkSpeed = 230;
      } else {
        this.player.setFillStyle(0x2ecc71);
        this.roleText.setText('ROLE: SURVIVOR').setColor('#2ecc71');
        this.objectiveText.setText('OBJECTIVE: Find the Clearance Keycard (E)').setColor('#f1c40f');
        this.walkSpeed = 180;
      }

      Object.keys(data.players).forEach((id) => {
        if (id !== this.socket.id) {
          this.addOtherPlayer(data.players[id]);
        }
      });
    });

    this.socket.on('playerMoved', (playerInfo) => {
      this.otherPlayers.getChildren().forEach((other) => {
        if (playerInfo.id === other.playerId) {
          other.setPosition(playerInfo.x, playerInfo.y);
          other.setAngle(playerInfo.angle);
        }
      });
    });

    this.socket.on('playerDisconnected', (playerId) => {
      this.otherPlayers.getChildren().forEach((other) => {
        if (playerId === other.playerId) other.destroy();
      });
    });

    this.socket.on('itemCollected', (info) => {
      this.keycardSprite.setVisible(false);
      this.interactionPrompt.setVisible(false);
      this.exitDoor.setFillStyle(0x27ae60);
      this.exitDoorText.setText('OPEN').setColor('#ffffff');

      if (info.collectorId === this.socket.id) {
        this.hasKeycard = true;
        this.objectiveText.setText('OBJECTIVE: Keycard acquired! Reach the EXIT!').setColor('#2ecc71');
      } else if (this.role === 'survivor') {
        this.objectiveText.setText('OBJECTIVE: Teammate opened the door! Reach the EXIT!').setColor('#3498db');
      } else {
        this.objectiveText.setText('WARNING: Survivors unlocked the EXIT! Intercept them!').setColor('#ff4444');
      }
    });

    // Game Over Handler
    this.socket.on('gameOver', (data) => {
      this.isMatchActive = false;
      this.player.body.setVelocity(0);

      const bannerColor = data.winner === 'survivor' ? '#2ecc71' : '#e74c3c';
      this.endBannerText.setText(data.message).setColor(bannerColor);
      this.endContainer.setVisible(true);
    });
  }

  addOtherPlayer(playerInfo) {
    const color = playerInfo.role === 'hunter' ? 0xe74c3c : 0x3498db;
    const other = this.add.rectangle(playerInfo.x, playerInfo.y, 36, 36, color).setDepth(5);
    other.playerId = playerInfo.id;
    this.otherPlayers.add(other);
  }

  update(time, delta) {
    const dt = delta / 1000;

    // Freeze inputs while in lobby waiting for 3 players
    if (!this.isMatchActive) {
      this.player.body.setVelocity(0);
      this.darkness.clear();
      this.darkness.fill(0x0a0a10, 0.4);
      return;
    }

    // Movement
    const isMoving = this.wasd.left.isDown || this.wasd.right.isDown || this.wasd.up.isDown || this.wasd.down.isDown;
    let currentSpeed = this.walkSpeed;

    if (this.role === 'survivor') {
      const wantsToSprint = this.shiftKey.isDown && isMoving && !this.isExhausted && this.stamina > 5;
      if (wantsToSprint) {
        currentSpeed = this.sprintSpeed;
        this.stamina = Math.max(0, this.stamina - 28 * dt);
        this.anxiety = Math.min(this.maxAnxiety, this.anxiety + 3 * dt);
        if (this.stamina === 0) this.isExhausted = true;
      } else {
        this.stamina = Math.min(this.maxStamina, this.stamina + (isMoving ? 10 : 20) * dt);
        if (this.isExhausted && this.stamina >= 25) this.isExhausted = false;
      }
      this.anxiety = Math.min(this.maxAnxiety, this.anxiety + 0.8 * dt);
    }

    this.player.body.setVelocity(0);
    if (this.wasd.left.isDown) this.player.body.setVelocityX(-currentSpeed);
    else if (this.wasd.right.isDown) this.player.body.setVelocityX(currentSpeed);
    if (this.wasd.up.isDown) this.player.body.setVelocityY(-currentSpeed);
    else if (this.wasd.down.isDown) this.player.body.setVelocityY(currentSpeed);

    // Aiming
    const pointer = this.input.activePointer;
    let angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, pointer.x, pointer.y);

    // Keycard pickup
    if (this.keycardSprite.visible && this.role === 'survivor') {
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.keycardSprite.x, this.keycardSprite.y);
      if (dist < 55) {
        this.interactionPrompt.setVisible(true);
        if (Phaser.Input.Keyboard.JustDown(this.interactKey)) {
          this.socket.emit('pickupItem');
        }
      } else {
        this.interactionPrompt.setVisible(false);
      }
    }

    // Survivor Escape Check
    if (this.hasKeycard && !this.hasEscaped) {
      const distToDoor = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.exitDoor.x, this.exitDoor.y);
      if (distToDoor < 45) {
        this.hasEscaped = true;
        this.socket.emit('playerEscaped');
      }
    }

    // Network Sync
    if (this.socket && this.socket.connected) {
      const x = this.player.x;
      const y = this.player.y;
      const deg = Phaser.Math.RadToDeg(angle);

      if (this.player.oldPosition && (
        x !== this.player.oldPosition.x ||
        y !== this.player.oldPosition.y ||
        deg !== this.player.oldPosition.angle
      )) {
        this.socket.emit('playerMovement', { x, y, angle: deg });
      }
      this.player.oldPosition = { x, y, angle: deg };
    }

    // Darkness & Flashlight
    this.darkness.clear();
    if (this.role === 'hunter') {
      this.darkness.fill(0x3a0007, 0.25);
    } else {
      this.darkness.fill(0x050508, 0.98);
      this.lightMask.setAngle(Phaser.Math.RadToDeg(angle));
      this.darkness.erase(this.lightMask, this.player.x, this.player.y);
    }

    this.drawHUD();
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