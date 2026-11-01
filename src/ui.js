import Phaser from 'phaser';

export class UIManager {
  constructor(scene) {
    this.scene = scene;

    this.hud = scene.add.graphics().setDepth(20).setScrollFactor(0);
    this.heartbeatVignette = scene.add.graphics().setDepth(8).setScrollFactor(0);

    this.smoothedDanger = 0;
    this.pulsePhase = 0;

    // Floating channel bar above player (world space)
    this.channelBarBg = scene.add.rectangle(0, 0, 46, 7, 0x222226, 0.9).setDepth(26).setVisible(false);
    this.channelBarFill = scene.add.rectangle(0, 0, 0, 5, 0x00ff88, 1.0).setDepth(27).setVisible(false);

    this.createHUD();
    this.createGameOverUI();
  }

  createHUD() {
    const cx = this.scene.scale.width / 2;

    this.roleText = this.scene.add.text(24, 20, 'WAITING FOR PLAYERS (1/3)...', {
      fontSize: '13px',
      color: '#f1c40f',
      fontFamily: 'monospace'
    }).setDepth(21).setScrollFactor(0);

    // Objectives list (top-left)
    this.taskListHeader = this.scene.add.text(24, 44, 'OBJECTIVES:', {
      fontSize: '12px',
      color: '#ffffff',
      fontFamily: 'monospace',
      fontStyle: 'bold'
    }).setDepth(21).setVisible(false).setScrollFactor(0);

    this.taskItem1 = this.scene.add.text(24, 62, '[ ] Bypass Security Terminal', {
      fontSize: '12px',
      color: '#aaaaaa',
      fontFamily: 'monospace'
    }).setDepth(21).setVisible(false).setScrollFactor(0);

    this.taskItem2 = this.scene.add.text(24, 80, '[ ] Escape Through Exit', {
      fontSize: '12px',
      color: '#555555',
      fontFamily: 'monospace'
    }).setDepth(21).setVisible(false).setScrollFactor(0);

    // TOP-CENTER SPECTATOR BANNER
    this.spectatorBanner = this.scene.add.text(cx, 32, '', {
      fontSize: '18px',
      fontFamily: 'monospace',
      fontStyle: 'bold',
      align: 'center',
      backgroundColor: '#000000aa',
      padding: { x: 14, y: 6 }
    }).setOrigin(0.5, 0.5).setDepth(30).setVisible(false).setScrollFactor(0);

    this.spectatorTip = this.scene.add.text(cx, 62, '[SPACE] to switch view', {
      fontSize: '11px',
      fontFamily: 'monospace',
      color: '#bbbbbb',
      align: 'center'
    }).setOrigin(0.5, 0.5).setDepth(30).setVisible(false).setScrollFactor(0);

    // Hunter Attack Status
    this.attackCooldownText = this.scene.add.text(24, 46, 'ATTACK: READY', {
      fontSize: '12px',
      color: '#2ecc71',
      fontFamily: 'monospace'
    }).setDepth(21).setVisible(false).setScrollFactor(0);
  }

  createGameOverUI() {
    const width = this.scene.scale.width;
    const height = this.scene.scale.height;
    const cx = width / 2;
    const cy = height / 2;

    this.isGameOverVisible = false;

    // Full screen overlay drawn in camera screen space
    this.endOverlay = this.scene.add.rectangle(cx, cy, width, height, 0x000000, 0.85)
      .setDepth(100)
      .setScrollFactor(0)
      .setVisible(false);

    this.endBannerText = this.scene.add.text(cx, cy - 60, '', {
      fontSize: '28px',
      fontFamily: 'monospace',
      fontStyle: 'bold',
      align: 'center',
      lineSpacing: 8
    }).setOrigin(0.5).setDepth(101).setScrollFactor(0).setVisible(false);

    this.btnBg = this.scene.add.rectangle(cx, cy + 45, 200, 46, 0x27ae60)
      .setDepth(101)
      .setScrollFactor(0)
      .setVisible(false);

    this.btnText = this.scene.add.text(cx, cy + 45, 'PLAY AGAIN', {
      fontSize: '16px',
      fontFamily: 'monospace',
      fontStyle: 'bold',
      color: '#ffffff'
    }).setOrigin(0.5).setDepth(102).setScrollFactor(0).setVisible(false);

    // Screen-space pointer click test (immune to camera offsets)
    this.scene.input.on('pointerdown', (pointer) => {
      if (!this.isGameOverVisible) return;

      const px = pointer.x;
      const py = pointer.y;

      const btnLeft = cx - 100;
      const btnRight = cx + 100;
      const btnTop = cy + 45 - 23;
      const btnBottom = cy + 45 + 23;

      if (px >= btnLeft && px <= btnRight && py >= btnTop && py <= btnBottom) {
        this.btnBg.setFillStyle(0x1e8449);
        this.scene.socket.emit('requestRestart');
      }
    });

    this.scene.input.on('pointermove', (pointer) => {
      if (!this.isGameOverVisible) return;

      const px = pointer.x;
      const py = pointer.y;
      const btnLeft = cx - 100;
      const btnRight = cx + 100;
      const btnTop = cy + 45 - 23;
      const btnBottom = cy + 45 + 23;

      if (px >= btnLeft && px <= btnRight && py >= btnTop && py <= btnBottom) {
        this.btnBg.setFillStyle(0x2ecc71);
      } else {
        this.btnBg.setFillStyle(0x27ae60);
      }
    });
  }

  showGameOver(message, color) {
    this.isGameOverVisible = true;

    this.endBannerText.setText(message).setColor(color);
    this.endOverlay.setVisible(true);
    this.endBannerText.setVisible(true);
    this.btnBg.setVisible(true);
    this.btnText.setVisible(true);

    this.spectatorBanner.setVisible(false);
    this.spectatorTip.setVisible(false);
  }

  hideGameOver() {
    this.isGameOverVisible = false;
    this.endOverlay.setVisible(false);
    this.endBannerText.setVisible(false);
    this.btnBg.setVisible(false);
    this.btnText.setVisible(false);
  }

  showEliminated() {
    this.taskListHeader.setVisible(false);
    this.taskItem1.setVisible(false);
    this.taskItem2.setVisible(false);
    this.attackCooldownText.setVisible(false);

    this.spectatorBanner.setText('ELIMINATED (SPECTATING)').setColor('#ff3b30').setVisible(true);
    this.spectatorTip.setVisible(true);
  }

  showEscaped() {
    this.taskListHeader.setVisible(false);
    this.taskItem1.setVisible(false);
    this.taskItem2.setVisible(false);

    this.spectatorBanner.setText('ESCAPED (SPECTATING)').setColor('#2ecc71').setVisible(true);
    this.spectatorTip.setVisible(true);
  }

  setChannelProgress(visible, ratio = 0, px = 0, py = 0) {
    if (!visible) {
      this.channelBarBg.setVisible(false);
      this.channelBarFill.setVisible(false);
      return;
    }
    this.channelBarBg.setPosition(px, py - 28).setVisible(true);
    this.channelBarFill.setPosition(px - 22 + (ratio * 44) / 2, py - 28)
      .setSize(ratio * 44, 5)
      .setVisible(true);
  }

  update(dt, playerController) {
    this.hud.clear();

    if (this.scene.role === 'hunter' && this.scene.isMatchActive) {
      this.taskListHeader.setVisible(false);
      this.taskItem1.setVisible(false);
      this.taskItem2.setVisible(false);
      this.spectatorBanner.setVisible(false);
      this.spectatorTip.setVisible(false);
      this.attackCooldownText.setVisible(true);

      if (this.scene.canAttack) {
        this.attackCooldownText.setText('ATTACK: READY [L-CLICK]').setColor('#2ecc71');
      } else {
        const pct = Math.ceil((this.scene.attackCooldownTimer / this.scene.attackCooldownDuration) * 10) / 10;
        this.attackCooldownText.setText(`ATTACK: RECHARGING (${pct}s)`).setColor('#e74c3c');
        this.hud.fillStyle(0x222226, 0.8);
        this.hud.fillRect(24, 68, 140, 8);
        this.hud.fillStyle(0xe74c3c, 1.0);
        const fillW = (1 - (this.scene.attackCooldownTimer / this.scene.attackCooldownDuration)) * 140;
        this.hud.fillRect(24, 68, fillW, 8);
      }
      return;
    }

    this.attackCooldownText.setVisible(false);

    if (!this.scene.isAlive || this.scene.hasEscaped || !this.scene.isMatchActive) return;

    this.taskListHeader.setVisible(true);
    this.taskItem1.setVisible(true);
    this.taskItem2.setVisible(true);
    this.spectatorBanner.setVisible(false);
    this.spectatorTip.setVisible(false);

    // Stamina Bar
    this.hud.fillStyle(0x222226, 0.8);
    this.hud.fillRect(24, 106, 140, 9);
    const stamColor = playerController.isExhausted ? 0xe74c3c : 0x2ecc71;
    this.hud.fillStyle(stamColor, 1.0);
    this.hud.fillRect(24, 106, (playerController.stamina / playerController.maxStamina) * 140, 9);

    // Anxiety Bar
    this.hud.fillStyle(0x222226, 0.8);
    this.hud.fillRect(24, 122, 140, 9);
    const anxColor = playerController.anxiety > 75 ? 0xe74c3c : 0x9b59b6;
    this.hud.fillStyle(anxColor, 1.0);
    this.hud.fillRect(24, 122, (playerController.anxiety / playerController.maxAnxiety) * 140, 9);

    this.updateHeartbeat(dt);
  }

  updateHeartbeat(dt) {
    this.heartbeatVignette.clear();
    if (!this.scene.isAlive || this.scene.hasEscaped) return;

    let hunterDistance = 9999;
    this.scene.otherPlayers.getChildren().forEach((other) => {
      if (other.playerRole === 'hunter') {
        const d = Phaser.Math.Distance.Between(this.scene.player.x, this.scene.player.y, other.x, other.y);
        if (d < hunterDistance) hunterDistance = d;
      }
    });

    const DANGER_ZONE = 380;
    const targetDanger = hunterDistance < DANGER_ZONE ? 1 - (hunterDistance / DANGER_ZONE) : 0;
    this.smoothedDanger = Phaser.Math.Linear(this.smoothedDanger, targetDanger, Math.min(1, 12 * dt));

    if (this.smoothedDanger > 0.02) {
      const currentFrequency = 4 + this.smoothedDanger * 10;
      this.pulsePhase += currentFrequency * dt;

      const rawWave = (Math.sin(this.pulsePhase) + 1) * 0.5;
      const beatIntensity = Math.pow(rawWave, 1.4);

      const baseAlpha = this.smoothedDanger * 0.18;
      const peakAlpha = this.smoothedDanger * 0.55;
      const finalAlpha = baseAlpha + beatIntensity * peakAlpha;

      const thickness = 16 + this.smoothedDanger * 26;
      this.heartbeatVignette.lineStyle(thickness, 0xa30000, finalAlpha);
      this.heartbeatVignette.strokeRect(0, 0, this.scene.scale.width, this.scene.scale.height);
    }
  }
}