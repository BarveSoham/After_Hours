import Phaser from 'phaser';

export class UIManager {
  constructor(scene) {
    this.scene = scene;

    this.hud = scene.add.graphics().setDepth(20);
    this.heartbeatVignette = scene.add.graphics().setDepth(8);

    this.smoothedDanger = 0;
    this.pulsePhase = 0;

    // Floating channel bar above player
    this.channelBarBg = scene.add.rectangle(0, 0, 46, 7, 0x222226, 0.9).setDepth(26).setVisible(false);
    this.channelBarFill = scene.add.rectangle(0, 0, 0, 5, 0x00ff88, 1.0).setDepth(27).setVisible(false);

    this.createHUD();
    this.createGameOverUI();
  }

  createHUD() {
    this.roleText = this.scene.add.text(20, 15, 'WAITING FOR PLAYERS (1/3)...', {
      fontSize: '12px',
      color: '#f1c40f',
      fontFamily: 'monospace'
    }).setDepth(21);

    this.taskListHeader = this.scene.add.text(20, 35, 'OBJECTIVES:', {
      fontSize: '11px',
      color: '#ffffff',
      fontFamily: 'monospace',
      fontStyle: 'bold'
    }).setDepth(21).setVisible(false);

    this.taskItem1 = this.scene.add.text(20, 50, '[ ] Bypass Security Terminal', {
      fontSize: '11px',
      color: '#aaaaaa',
      fontFamily: 'monospace'
    }).setDepth(21).setVisible(false);

    this.taskItem2 = this.scene.add.text(20, 66, '[ ] Escape Through Exit', {
      fontSize: '11px',
      color: '#555555',
      fontFamily: 'monospace'
    }).setDepth(21).setVisible(false);

    this.attackCooldownText = this.scene.add.text(20, 45, 'ATTACK: READY', {
      fontSize: '11px',
      color: '#2ecc71',
      fontFamily: 'monospace'
    }).setDepth(21).setVisible(false);
  }

  createGameOverUI() {
    this.endContainer = this.scene.add.container(400, 300).setDepth(50).setVisible(false);
    const overlay = this.scene.add.rectangle(0, 0, 800, 600, 0x000000, 0.85);

    this.endBannerText = this.scene.add.text(0, -60, '', {
      fontSize: '26px',
      fontFamily: 'monospace',
      fontStyle: 'bold',
      align: 'center',
      lineSpacing: 8
    }).setOrigin(0.5);

    const btnBg = this.scene.add.rectangle(0, 45, 200, 44, 0x27ae60)
      .setInteractive({ useHandCursor: true });

    const btnText = this.scene.add.text(0, 45, 'PLAY AGAIN', {
      fontSize: '16px',
      fontFamily: 'monospace',
      fontStyle: 'bold',
      color: '#ffffff'
    }).setOrigin(0.5);

    btnBg.on('pointerover', () => btnBg.setFillStyle(0x2ecc71));
    btnBg.on('pointerout', () => btnBg.setFillStyle(0x27ae60));
    btnBg.on('pointerdown', () => this.scene.socket.emit('requestRestart'));

    this.endContainer.add([overlay, this.endBannerText, btnBg, btnText]);
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
      this.attackCooldownText.setVisible(true);

      if (this.scene.canAttack) {
        this.attackCooldownText.setText('ATTACK: READY [L-CLICK]').setColor('#2ecc71');
      } else {
        const pct = Math.ceil((this.scene.attackCooldownTimer / this.scene.attackCooldownDuration) * 10) / 10;
        this.attackCooldownText.setText(`ATTACK: RECHARGING (${pct}s)`).setColor('#e74c3c');
        this.hud.fillStyle(0x222226, 0.8);
        this.hud.fillRect(20, 62, 140, 8);
        this.hud.fillStyle(0xe74c3c, 1.0);
        const fillW = (1 - (this.scene.attackCooldownTimer / this.scene.attackCooldownDuration)) * 140;
        this.hud.fillRect(20, 62, fillW, 8);
      }
      return;
    }

    this.attackCooldownText.setVisible(false);

    if (this.scene.role !== 'survivor' || !this.scene.isMatchActive || !this.scene.isAlive || this.scene.hasEscaped) return;

    this.taskListHeader.setVisible(true);
    this.taskItem1.setVisible(true);
    this.taskItem2.setVisible(true);

    // Stamina Bar
    this.hud.fillStyle(0x222226, 0.8);
    this.hud.fillRect(20, 90, 140, 9);
    const stamColor = playerController.isExhausted ? 0xe74c3c : 0x2ecc71;
    this.hud.fillStyle(stamColor, 1.0);
    this.hud.fillRect(20, 90, (playerController.stamina / playerController.maxStamina) * 140, 9);

    // Anxiety Bar
    this.hud.fillStyle(0x222226, 0.8);
    this.hud.fillRect(20, 106, 140, 9);
    const anxColor = playerController.anxiety > 75 ? 0xe74c3c : 0x9b59b6;
    this.hud.fillStyle(anxColor, 1.0);
    this.hud.fillRect(20, 106, (playerController.anxiety / playerController.maxAnxiety) * 140, 9);

    this.updateHeartbeat(dt);
  }

  updateHeartbeat(dt) {
    this.heartbeatVignette.clear();

    let hunterDistance = 9999;
    this.scene.otherPlayers.getChildren().forEach((other) => {
      if (other.playerRole === 'hunter') {
        const d = Phaser.Math.Distance.Between(this.scene.player.x, this.scene.player.y, other.x, other.y);
        if (d < hunterDistance) hunterDistance = d;
      }
    });

    const DANGER_ZONE = 360;
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
      this.heartbeatVignette.strokeRect(0, 0, 800, 600);
    }
  }
}