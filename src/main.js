import Phaser from 'phaser';
import { io } from 'socket.io-client';

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

    // Attack cooldown state (local visual sync)
    this.canAttack = true;
    this.attackCooldownTimer = 0;
    this.attackCooldownDuration = 1200;

    // 1. Room Obstacles
    this.obstacles = this.physics.add.staticGroup();
    this.createSolidRoom();

    // 2. Exit Gate
    this.exitDoor = this.add.rectangle(740, 80, 60, 60, 0x444444);
    this.exitDoorText = this.add.text(740, 80, 'EXIT\n[LOCKED]', {
      fontSize: '11px',
      fontFamily: 'monospace',
      align: 'center',
      color: '#ff4444'
    }).setOrigin(0.5);

    // 3. Keycard Sprite
    this.keycardSprite = this.add.rectangle(0, 0, 24, 16, 0xf1c40f).setVisible(false);
    this.interactionPrompt = this.add.text(0, 0, 'Press E', {
      fontSize: '12px',
      fontFamily: 'monospace',
      backgroundColor: '#000000cc',
      padding: { x: 4, y: 2 }
    }).setOrigin(0.5).setVisible(false).setDepth(25);

    // 4. Local Player Sprite
    this.player = this.add.rectangle(400, 300, 36, 36, 0x888888);
    this.physics.add.existing(this.player);
    this.player.body.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, this.obstacles);

    // 5. Controls
    this.wasd = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D
    });
    this.shiftKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.interactKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);

    // Hunter Attack with local cooldown lock
    this.input.on('pointerdown', (pointer) => {
      if (pointer.leftButtonDown() && this.role === 'hunter' && this.isMatchActive && this.canAttack) {
        this.canAttack = false;
        this.attackCooldownTimer = this.attackCooldownDuration;
        this.socket.emit('hunterAttack');
        this.cameras.main.shake(80, 0.005);
      }
    });

    this.walkSpeed = 180;
    this.sprintSpeed = 310;
    this.stamina = 100;
    this.maxStamina = 100;
    this.anxiety = 0;
    this.maxAnxiety = 100;
    this.isExhausted = false;

    // 6. Proximity Heartbeat Vignette Overlay (Survivor only)
    this.heartbeatVignette = this.add.graphics().setDepth(8);
    this.smoothedDanger = 0;   // Interpolated danger level (0 to 1)
    this.pulsePhase = 0;       // Continuous sine phase accumulator

    // 7. Darkness Mask
    this.darkness = this.add.renderTexture(0, 0, 800, 600).setDepth(10);
    this.createFlashlightGraphic();

    // 8. HUD & Overlays
    this.createHUD();
    this.createGameOverUI();

    // 9. Sockets
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

    this.attackCooldownText = this.add.text(20, 58, 'ATTACK: READY', {
      fontSize: '11px',
      color: '#2ecc71',
      fontFamily: 'monospace'
    }).setDepth(21).setVisible(false);
  }

  createGameOverUI() {
    this.endContainer = this.add.container(400, 300).setDepth(50).setVisible(false);

    const overlay = this.add.rectangle(0, 0, 800, 600, 0x000000, 0.85);

    this.endBannerText = this.add.text(0, -60, '', {
      fontSize: '26px',
      fontFamily: 'monospace',
      fontStyle: 'bold',
      align: 'center',
      lineSpacing: 8
    }).setOrigin(0.5);

    const btnBg = this.add.rectangle(0, 45, 200, 44, 0x27ae60)
      .setInteractive({ useHandCursor: true });

    const btnText = this.add.text(0, 45, 'PLAY AGAIN', {
      fontSize: '16px',
      fontFamily: 'monospace',
      fontStyle: 'bold',
      color: '#ffffff'
    }).setOrigin(0.5);

    btnBg.on('pointerover', () => btnBg.setFillStyle(0x2ecc71));
    btnBg.on('pointerout', () => btnBg.setFillStyle(0x27ae60));
    btnBg.on('pointerdown', () => this.socket.emit('requestRestart'));

    this.endContainer.add([overlay, this.endBannerText, btnBg, btnText]);
  }

  drawHUD() {
    this.hud.clear();

    if (this.role === 'hunter' && this.isMatchActive) {
      this.attackCooldownText.setVisible(true);
      if (this.canAttack) {
        this.attackCooldownText.setText('ATTACK: READY [L-CLICK]').setColor('#2ecc71');
      } else {
        const pct = Math.ceil((this.attackCooldownTimer / this.attackCooldownDuration) * 10) / 10;
        this.attackCooldownText.setText(`ATTACK: RECHARGING (${pct}s)`).setColor('#e74c3c');
        this.hud.fillStyle(0x222226, 0.8);
        this.hud.fillRect(20, 75, 140, 8);
        this.hud.fillStyle(0xe74c3c, 1.0);
        const fillW = (1 - (this.attackCooldownTimer / this.attackCooldownDuration)) * 140;
        this.hud.fillRect(20, 75, fillW, 8);
      }
      return;
    }

    this.attackCooldownText.setVisible(false);

    if (this.role !== 'survivor' || !this.isMatchActive || !this.isAlive || this.hasEscaped) return;

    // Stamina
    this.hud.fillStyle(0x222226, 0.8);
    this.hud.fillRect(20, 60, 140, 10);
    const stamColor = this.isExhausted ? 0xe74c3c : 0x2ecc71;
    this.hud.fillStyle(stamColor, 1.0);
    this.hud.fillRect(20, 60, (this.stamina / this.maxStamina) * 140, 10);

    // Anxiety
    this.hud.fillStyle(0x222226, 0.8);
    this.hud.fillRect(20, 78, 140, 10);
    const anxColor = this.anxiety > 75 ? 0xe74c3c : 0x9b59b6;
    this.hud.fillStyle(anxColor, 1.0);
    this.hud.fillRect(20, 78, (this.anxiety / this.maxAnxiety) * 140, 10);
  }

  // SMOOTHED HEARTBEAT LOGIC
  updateProximityHeartbeat(dt) {
    this.heartbeatVignette.clear();
    if (this.role !== 'survivor' || !this.isMatchActive || !this.isAlive || this.hasEscaped) {
      this.smoothedDanger = 0;
      return;
    }

    // 1. Find closest Hunter
    let hunterDistance = 9999;
    this.otherPlayers.getChildren().forEach((other) => {
      if (other.playerRole === 'hunter') {
        const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, other.x, other.y);
        if (d < hunterDistance) hunterDistance = d;
      }
    });

    const DANGER_ZONE = 360;
    const targetDanger = hunterDistance < DANGER_ZONE 
      ? 1 - (hunterDistance / DANGER_ZONE) 
      : 0;

    // Fast, responsive lerp (12 * dt reacts 3x faster without packet stutter)
    this.smoothedDanger = Phaser.Math.Linear(this.smoothedDanger, targetDanger, Math.min(1, 12 * dt));

    if (this.smoothedDanger > 0.02) {
      // Frequency ramps up immediately from 4 rad/s to 14 rad/s
      const currentFrequency = 4 + this.smoothedDanger * 10;
      this.pulsePhase += currentFrequency * dt;

      // Tight, responsive pulse wave: fast attack and immediate visibility
      const rawWave = (Math.sin(this.pulsePhase) + 1) * 0.5; // 0 to 1
      const beatIntensity = Math.pow(rawWave, 1.4);          // lower exponent = longer, punchier visibility

      // Immediate visible base presence + pulsing heartbeat
      const baseAlpha = this.smoothedDanger * 0.18;
      const peakAlpha = this.smoothedDanger * 0.55;
      const finalAlpha = baseAlpha + beatIntensity * peakAlpha;

      const thickness = 16 + this.smoothedDanger * 26;

      this.heartbeatVignette.lineStyle(thickness, 0xa30000, finalAlpha);
      this.heartbeatVignette.strokeRect(0, 0, 800, 600);
    }
  }

  setupSocketEvents() {
    this.socket.on('lobbyUpdate', (lobby) => {
      if (lobby.gameState === 'waiting') {
        this.isMatchActive = false;
        this.roleText.setText(`WAITING FOR PLAYERS (${lobby.count}/${lobby.required})...`).setColor('#f1c40f');
        this.objectiveText.setText('Stand by in lobby').setColor('#aaaaaa');
        this.player.setFillStyle(0x888888);
      }
    });

    this.socket.on('matchStarted', (data) => {
      this.endContainer.setVisible(false);
      this.isAlive = true;
      this.hasEscaped = false;
      this.taskCompleted = false;
      this.stamina = 100;
      this.anxiety = 0;
      this.isExhausted = false;
      this.isMatchActive = true;
      this.canAttack = true;
      this.attackCooldownTimer = 0;

      this.exitDoor.setFillStyle(0x444444);
      this.exitDoorText.setText('EXIT\n[LOCKED]').setColor('#ff4444');

      this.otherPlayers.clear(true, true);
      this.footprintsGroup.clear(true, true);

      const myData = data.players[this.socket.id];
      this.role = myData.role;
      this.player.setPosition(myData.x, myData.y);
      this.player.setVisible(true);

      if (this.role === 'hunter') {
        this.player.setFillStyle(0xe74c3c);
        this.roleText.setText('ROLE: THE HUNTER').setColor('#e74c3c');
        this.objectiveText.setText('OBJECTIVE: Track and eliminate all survivors!').setColor('#ff4444');
        this.walkSpeed = 230;
        this.keycardSprite.setVisible(false);
      } else {
        this.player.setFillStyle(0x2ecc71);
        this.roleText.setText('ROLE: SURVIVOR').setColor('#2ecc71');
        this.objectiveText.setText('OBJECTIVE: Find your Clearance Keycard (E)').setColor('#f1c40f');
        this.walkSpeed = 180;

        const myTask = data.survivorTasks[this.socket.id];
        if (myTask) {
          this.keycardSprite.setPosition(myTask.x, myTask.y).setVisible(true);
          this.interactionPrompt.setPosition(myTask.x, myTask.y - 30);
        }
      }

      Object.keys(data.players).forEach((id) => {
        if (id !== this.socket.id) {
          this.addOtherPlayer(data.players[id]);
        }
      });

      this.socket.emit('playerMovement', {
        x: this.player.x,
        y: this.player.y,
        angle: 0,
        isSprinting: false
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

    this.socket.on('spawnFootprint', (data) => {
      if (this.role === 'hunter') {
        const footprint = this.add.ellipse(data.x, data.y, 10, 6, 0x00ffff, 0.85);
        footprint.setAngle(data.angle).setDepth(2);
        this.footprintsGroup.add(footprint);

        this.tweens.add({
          targets: footprint,
          alpha: 0,
          scale: 0.6,
          duration: 3200,
          ease: 'Linear',
          onComplete: () => {
            footprint.destroy();
          }
        });
      }
    });

    this.socket.on('attackExecuted', (data) => {
      this.canAttack = false;
      this.attackCooldownDuration = data.cooldownMs;
      this.attackCooldownTimer = data.cooldownMs;
    });

    this.socket.on('hunterHitEffect', () => {
      this.cameras.main.flash(200, 180, 0, 0);
    });

    this.socket.on('personalTaskDone', () => {
      this.taskCompleted = true;
      this.keycardSprite.setVisible(false);
      this.interactionPrompt.setVisible(false);

      this.exitDoor.setFillStyle(0x27ae60);
      this.exitDoorText.setText('EXIT\n[OPEN]').setColor('#ffffff');
      this.objectiveText.setText('OBJECTIVE: Keycard acquired! Escape through the EXIT!').setColor('#00ff88');
    });

    this.socket.on('youEscaped', () => {
      this.hasEscaped = true;
      this.player.setVisible(false);
      this.objectiveText.setText('YOU ESCAPED! Spectating remaining players...').setColor('#2ecc71');
    });

    this.socket.on('survivorEscapedNotification', ({ id }) => {
      this.otherPlayers.getChildren().forEach((other) => {
        if (other.playerId === id) other.destroy();
      });
    });

    this.socket.on('survivorEliminated', ({ victimId }) => {
      if (this.socket.id === victimId) {
        this.isAlive = false;
        this.player.setFillStyle(0x444444);
        this.objectiveText.setText('YOU WERE ELIMINATED! Spectating...').setColor('#ff4444');
      } else {
        this.otherPlayers.getChildren().forEach((other) => {
          if (other.playerId === victimId) {
            other.setFillStyle(0x444444);
          }
        });
      }
    });

    this.socket.on('gameOver', (data) => {
      this.isMatchActive = false;
      this.player.body.setVelocity(0);
      this.heartbeatVignette.clear();

      const bannerColor = data.winner === 'survivor' ? '#2ecc71' : '#e74c3c';
      this.endBannerText.setText(data.message).setColor(bannerColor);
      this.endContainer.setVisible(true);
    });
  }

  addOtherPlayer(playerInfo) {
    const color = playerInfo.role === 'hunter' ? 0xe74c3c : (playerInfo.alive ? 0x3498db : 0x444444);
    const other = this.add.rectangle(playerInfo.x, playerInfo.y, 36, 36, color).setDepth(5);
    other.playerId = playerInfo.id;
    other.playerRole = playerInfo.role;
    this.otherPlayers.add(other);
  }

  update(time, delta) {
    const dt = delta / 1000;

    // Cooldown decrement
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

    const isMoving = this.wasd.left.isDown || this.wasd.right.isDown || this.wasd.up.isDown || this.wasd.down.isDown;
    let currentSpeed = this.walkSpeed;
    let isSprinting = false;

    if (this.role === 'survivor') {
      const wantsToSprint = this.shiftKey.isDown && isMoving && !this.isExhausted && this.stamina > 5;
      if (wantsToSprint) {
        isSprinting = true;
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

    // Escape Check
    if (this.taskCompleted && !this.hasEscaped && this.role === 'survivor') {
      const distToDoor = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.exitDoor.x, this.exitDoor.y);
      if (distToDoor < 45) {
        this.socket.emit('playerEscaped');
      }
    }

    // Network Sync with movement flag
    if (this.socket && this.socket.connected) {
      const x = this.player.x;
      const y = this.player.y;
      const deg = Phaser.Math.RadToDeg(angle);

      if (this.player.oldPosition && (
        x !== this.player.oldPosition.x ||
        y !== this.player.oldPosition.y ||
        deg !== this.player.oldPosition.angle ||
        isSprinting !== this.player.oldPosition.isSprinting
      )) {
        this.socket.emit('playerMovement', { x, y, angle: deg, isSprinting });
      }
      this.player.oldPosition = { x, y, angle: deg, isSprinting };
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
    this.updateProximityHeartbeat(dt); // Passes dt so phase advances smoothly
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