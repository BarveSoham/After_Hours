import Phaser from 'phaser';
export class UIManager {
  constructor(scene) {
    this.scene = scene;

    this.hud = scene.add.graphics().setDepth(20).setScrollFactor(0);
    this.heartbeatVignette = scene.add.graphics().setDepth(15).setScrollFactor(0);

    this.smoothedDanger = 0;
    this.pulsePhase = 0;

    this.channelBarBg = scene.add.rectangle(0, 0, 46, 7, 0x222226, 0.9).setDepth(26).setVisible(false);
    this.channelBarFill = scene.add.rectangle(0, 0, 0, 5, 0x00ff88, 1.0).setDepth(27).setVisible(false);

    this.createHUD();
    this.createGameOverUI();
    this.createPauseUI();
  }

  createHUD() {
    const cx = this.scene.scale.width / 2;

    this.roleText = this.scene.add.text(24, 20, 'WAITING FOR PLAYERS (1/3)...', {
      fontSize: '13px',
      color: '#f1c40f',
      fontFamily: 'monospace'
    }).setDepth(21).setScrollFactor(0);

    this.taskListHeader = this.scene.add.text(24, 44, 'OBJECTIVES:', {
      fontSize: '12px',
      color: '#ffffff',
      fontFamily: 'monospace',
      fontStyle: 'bold'
    }).setDepth(21).setVisible(false).setScrollFactor(0);

    this.taskItem1 = this.scene.add.text(24, 62, '[ ] Bypass Security Terminal', {
      fontSize: '11px',
      color: '#aaaaaa',
      fontFamily: 'monospace'
    }).setDepth(21).setVisible(false).setScrollFactor(0);

    this.taskItem2 = this.scene.add.text(24, 78, '[ ] Escape: Exit Gate A', {
      fontSize: '11px',
      color: '#555555',
      fontFamily: 'monospace'
    }).setDepth(21).setVisible(false).setScrollFactor(0);

    this.taskItem3 = this.scene.add.text(24, 94, '[ ] Escape: Exit Gate B', {
      fontSize: '11px',
      color: '#555555',
      fontFamily: 'monospace'
    }).setDepth(21).setVisible(false).setScrollFactor(0);

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

    this.endOverlay = this.scene.add.rectangle(cx, cy, width, height, 0x000000, 0.85)
      .setDepth(100)
      .setScrollFactor(0)
      .setVisible(false);

    this.endBannerText = this.scene.add.text(cx, cy - 70, '', {
      fontSize: '28px',
      fontFamily: 'monospace',
      fontStyle: 'bold',
      align: 'center',
      lineSpacing: 8
    }).setOrigin(0.5).setDepth(101).setScrollFactor(0).setVisible(false);

    // PLAY AGAIN BUTTON
    this.btnBg = this.scene.add.rectangle(cx - 110, cy + 45, 190, 46, 0x27ae60)
      .setDepth(101)
      .setScrollFactor(0)
      .setVisible(false)
      .setInteractive({ useHandCursor: true });

    this.btnText = this.scene.add.text(cx - 110, cy + 45, 'PLAY AGAIN', {
      fontSize: '15px',
      fontFamily: 'monospace',
      fontStyle: 'bold',
      color: '#ffffff'
    }).setOrigin(0.5).setDepth(102).setScrollFactor(0).setVisible(false);

    this.btnBg.on('pointerover', () => {
      if (this.isGameOverVisible) this.btnBg.setFillStyle(0x2ecc71);
    });
    this.btnBg.on('pointerout', () => {
      if (this.isGameOverVisible) this.btnBg.setFillStyle(0x27ae60);
    });
    this.btnBg.on('pointerdown', () => {
      if (!this.isGameOverVisible) return;
      this.btnBg.setFillStyle(0x1e8449);
      this.scene.socket.emit('requestRestart');
    });

    // RETURN TO LOBBY BUTTON
    this.btnLobbyBg = this.scene.add.rectangle(cx + 110, cy + 45, 190, 46, 0x0c292b)
      .setDepth(101)
      .setScrollFactor(0)
      .setVisible(false)
      .setInteractive({ useHandCursor: true });

    this.btnLobbyText = this.scene.add.text(cx + 110, cy + 45, 'BACK TO LOBBY', {
      fontSize: '15px',
      fontFamily: 'monospace',
      fontStyle: 'bold',
      color: '#4fffe3'
    }).setOrigin(0.5).setDepth(102).setScrollFactor(0).setVisible(false);

    this.btnLobbyBg.on('pointerover', () => {
      if (this.isGameOverVisible) this.btnLobbyBg.setFillStyle(0x16403d);
    });
    this.btnLobbyBg.on('pointerout', () => {
      if (this.isGameOverVisible) this.btnLobbyBg.setFillStyle(0x0c292b);
    });
    this.btnLobbyBg.on('pointerdown', () => {
      if (!this.isGameOverVisible) return;
      this.btnLobbyBg.setFillStyle(0x081e20);
      this.scene.returnToLobby();
    });
  }

  createPauseUI() {
    const width = this.scene.scale.width;
    const height = this.scene.scale.height;
    const cx = width / 2;
    const cy = height / 2;

    this.isPauseVisible = false;

    this.pauseOverlay = this.scene.add.rectangle(cx, cy, width, height, 0x000000, 0.78)
      .setDepth(90)
      .setScrollFactor(0)
      .setVisible(false);

    this.pauseTitle = this.scene.add.text(cx, cy - 65, 'SYSTEM PAUSED', {
      fontSize: '28px',
      fontFamily: 'monospace',
      fontStyle: 'bold',
      color: '#ffffff',
      letterSpacing: 2
    }).setOrigin(0.5).setDepth(91).setScrollFactor(0).setVisible(false);

    this.pauseSub = this.scene.add.text(cx, cy - 25, 'Warning: The match continues around you!', {
      fontSize: '12px',
      fontFamily: 'monospace',
      color: '#ff4444'
    }).setOrigin(0.5).setDepth(91).setScrollFactor(0).setVisible(false);

    // RESUME BUTTON
    this.btnResumeBg = this.scene.add.rectangle(cx, cy + 25, 210, 44, 0x27ae60)
      .setDepth(91)
      .setScrollFactor(0)
      .setVisible(false)
      .setInteractive({ useHandCursor: true });

    this.btnResumeText = this.scene.add.text(cx, cy + 25, 'RESUME [ESC]', {
      fontSize: '15px',
      fontFamily: 'monospace',
      fontStyle: 'bold',
      color: '#ffffff'
    }).setOrigin(0.5).setDepth(92).setScrollFactor(0).setVisible(false);

    this.btnResumeBg.on('pointerover', () => {
      if (this.isPauseVisible) this.btnResumeBg.setFillStyle(0x2ecc71);
    });
    this.btnResumeBg.on('pointerout', () => {
      if (this.isPauseVisible) this.btnResumeBg.setFillStyle(0x27ae60);
    });
    this.btnResumeBg.on('pointerdown', () => {
      if (!this.isPauseVisible) return;
      this.scene.togglePause(false);
    });

    // ABANDON / RETURN TO LOBBY BUTTON
    this.btnPauseLobbyBg = this.scene.add.rectangle(cx, cy + 85, 210, 44, 0x0c292b)
      .setDepth(91)
      .setScrollFactor(0)
      .setVisible(false)
      .setInteractive({ useHandCursor: true });

    this.btnPauseLobbyText = this.scene.add.text(cx, cy + 85, 'ABANDON TO LOBBY', {
      fontSize: '14px',
      fontFamily: 'monospace',
      fontStyle: 'bold',
      color: '#4fffe3'
    }).setOrigin(0.5).setDepth(92).setScrollFactor(0).setVisible(false);

    this.btnPauseLobbyBg.on('pointerover', () => {
      if (this.isPauseVisible) this.btnPauseLobbyBg.setFillStyle(0x16403d);
    });
    this.btnPauseLobbyBg.on('pointerout', () => {
      if (this.isPauseVisible) this.btnPauseLobbyBg.setFillStyle(0x0c292b);
    });
    this.btnPauseLobbyBg.on('pointerdown', () => {
      if (!this.isPauseVisible) return;
      this.scene.returnToLobby();
    });

    // EXIT TO MAIN MENU BUTTON
    this.btnPauseMenuBg = this.scene.add.rectangle(cx, cy + 140, 210, 40, 0x180b0b)
      .setDepth(91)
      .setScrollFactor(0)
      .setVisible(false)
      .setInteractive({ useHandCursor: true });

    this.btnPauseMenuText = this.scene.add.text(cx, cy + 140, 'EXIT TO MAIN MENU', {
      fontSize: '13px',
      fontFamily: 'monospace',
      fontStyle: 'bold',
      color: '#ff6666'
    }).setOrigin(0.5).setDepth(92).setScrollFactor(0).setVisible(false);

    this.btnPauseMenuBg.on('pointerover', () => {
      if (this.isPauseVisible) this.btnPauseMenuBg.setFillStyle(0x381010);
    });
    this.btnPauseMenuBg.on('pointerout', () => {
      if (this.isPauseVisible) this.btnPauseMenuBg.setFillStyle(0x180b0b);
    });
    this.btnPauseMenuBg.on('pointerdown', () => {
      if (!this.isPauseVisible) return;
      window.location.href = '/mainscreen/index.html';
    });
  }

  showPause() {
    this.isPauseVisible = true;
    this.pauseOverlay.setVisible(true);
    this.pauseTitle.setVisible(true);
    this.pauseSub.setVisible(true);
    this.btnResumeBg.setVisible(true);
    this.btnResumeText.setVisible(true);
    this.btnPauseLobbyBg.setVisible(true);
    this.btnPauseLobbyText.setVisible(true);
    this.btnPauseMenuBg.setVisible(true);
    this.btnPauseMenuText.setVisible(true);
  }

  hidePause() {
    this.isPauseVisible = false;
    this.pauseOverlay.setVisible(false);
    this.pauseTitle.setVisible(false);
    this.pauseSub.setVisible(false);
    this.btnResumeBg.setVisible(false);
    this.btnResumeText.setVisible(false);
    this.btnPauseLobbyBg.setVisible(false);
    this.btnPauseLobbyText.setVisible(false);
    this.btnPauseMenuBg.setVisible(false);
    this.btnPauseMenuText.setVisible(false);
  }

  showGameOver(message, color) {
    this.hidePause();
    this.isGameOverVisible = true;

    this.endBannerText.setText(message).setColor(color);
    this.endOverlay.setVisible(true);
    this.endBannerText.setVisible(true);
    this.btnBg.setVisible(true);
    this.btnText.setVisible(true);
    this.btnLobbyBg.setVisible(true);
    this.btnLobbyText.setVisible(true);

    this.spectatorBanner.setVisible(false);
    this.spectatorTip.setVisible(false);
  }

  hideGameOver() {
    this.hidePause();
    this.isGameOverVisible = false;
    this.endOverlay.setVisible(false);
    this.endBannerText.setVisible(false);
    this.btnBg.setVisible(false);
    this.btnText.setVisible(false);
    this.btnLobbyBg.setVisible(false);
    this.btnLobbyText.setVisible(false);
  }

  showEliminated() {
    this.taskListHeader.setVisible(false);
    this.taskItem1.setVisible(false);
    this.taskItem2.setVisible(false);
    this.taskItem3.setVisible(false);
    this.attackCooldownText.setVisible(false);

    this.spectatorBanner.setText('ELIMINATED (SPECTATING)').setColor('#ff3b30').setVisible(true);
    this.spectatorTip.setVisible(true);
  }

  showEscaped() {
    this.taskListHeader.setVisible(false);
    this.taskItem1.setVisible(false);
    this.taskItem2.setVisible(false);
    this.taskItem3.setVisible(false);

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
      this.taskItem3.setVisible(false);
      this.spectatorBanner.setVisible(false);
      this.spectatorTip.setVisible(false);
      this.attackCooldownText.setVisible(true);

      if (this.scene.canAttack) {
        if (this.attackCooldownText.text !== 'ATTACK: READY [L-CLICK]') {
          this.attackCooldownText.setText('ATTACK: READY [L-CLICK]').setColor('#2ecc71');
        }
      } else {
        const pct = Math.ceil((this.scene.attackCooldownTimer / this.scene.attackCooldownDuration) * 10) / 10;
        const cooldownStr = `ATTACK: RECHARGING (${pct}s)`;
        if (this.attackCooldownText.text !== cooldownStr) {
          this.attackCooldownText.setText(cooldownStr).setColor('#e74c3c');
        }
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

    // Live Waypoint Tracker to ALL powered exit gates
    if (this.scene.taskCompleted && this.scene.activeDoors && this.scene.activeDoors.length > 0) {
      const doorInfos = this.scene.activeDoors.map(d => {
        const dist = Phaser.Math.Distance.Between(this.scene.player.x, this.scene.player.y, d.x, d.y);
        const distM = Math.round(dist / 20);
        const angle = Phaser.Math.Angle.Between(this.scene.player.x, this.scene.player.y, d.x, d.y);
        const deg = Phaser.Math.RadToDeg(angle);
        let arrow = '➔';
        if (deg >= -45 && deg <= 45) arrow = '🠊 (EAST)';
        else if (deg > 45 && deg < 135) arrow = '🠋 (SOUTH)';
        else if (deg >= 135 || deg <= -135) arrow = '🠈 (WEST)';
        else arrow = '🠉 (NORTH)';
        return { door: d, dist, distM, arrow };
      });

      doorInfos.sort((a, b) => a.dist - b.dist);

      if (doorInfos.length >= 1) {
        const d1 = doorInfos[0];
        const text1 = `[!] ${d1.door.name.toUpperCase()} [${d1.distM}m ${d1.arrow}] *CLOSEST*`;
        if (this.taskItem2.text !== text1) {
          this.taskItem2.setText(text1).setColor('#00ff88');
        }
        this.taskItem2.setVisible(true);
      }
      if (doorInfos.length >= 2) {
        const d2 = doorInfos[1];
        const text2 = `[!] ${d2.door.name.toUpperCase()} [${d2.distM}m ${d2.arrow}]`;
        if (this.taskItem3.text !== text2) {
          this.taskItem3.setText(text2).setColor('#2ecc71');
        }
        this.taskItem3.setVisible(true);
      } else {
        this.taskItem3.setVisible(false);
      }
    } else {
      this.taskItem3.setVisible(false);
    }

    // Stamina Bar
    this.hud.fillStyle(0x222226, 0.8);
    this.hud.fillRect(24, 114, 140, 9);
    const stamColor = playerController.isExhausted ? 0xe74c3c : 0x2ecc71;
    this.hud.fillStyle(stamColor, 1.0);
    this.hud.fillRect(24, 114, (playerController.stamina / playerController.maxStamina) * 140, 9);

    // Anxiety Bar
    this.hud.fillStyle(0x222226, 0.8);
    this.hud.fillRect(24, 128, 140, 9);
    const anxColor = playerController.anxiety > 75 ? 0xe74c3c : 0x9b59b6;
    this.hud.fillStyle(anxColor, 1.0);
    this.hud.fillRect(24, 128, (playerController.anxiety / playerController.maxAnxiety) * 140, 9);

    this.updateHeartbeat(dt);
  }

  updateHeartbeat(dt) {
    this.heartbeatVignette.clear();
    // Only active survivors receive danger proximity heartbeat
    if (!this.scene.isAlive || this.scene.hasEscaped || !this.scene.isMatchActive || this.scene.role === 'hunter') return;

    let hunterDistance = 9999;
    this.scene.otherPlayers.getChildren().forEach((other) => {
      if (other.playerRole && other.playerRole.toLowerCase() === 'hunter') {
        const d = Phaser.Math.Distance.Between(this.scene.player.x, this.scene.player.y, other.x, other.y);
        if (d < hunterDistance) hunterDistance = d;
      }
    });

    const DANGER_ZONE = 420;
    const targetDanger = hunterDistance < DANGER_ZONE ? 1 - (hunterDistance / DANGER_ZONE) : 0;
    this.smoothedDanger = Phaser.Math.Linear(this.smoothedDanger, targetDanger, Math.min(1, 14 * dt));

    if (this.smoothedDanger > 0.02) {
      const currentFrequency = 4 + this.smoothedDanger * 10;
      this.pulsePhase += currentFrequency * dt;

      const rawWave = (Math.sin(this.pulsePhase) + 1) * 0.5;
      const beatIntensity = Math.pow(rawWave, 1.4);

      const baseAlpha = this.smoothedDanger * 0.25;
      const peakAlpha = this.smoothedDanger * 0.65;
      const finalAlpha = Math.min(0.95, baseAlpha + beatIntensity * peakAlpha);

      const w = this.scene.scale.width;
      const h = this.scene.scale.height;

      // Vivid crimson pulsing border vignette anchored within screen bounds
      const thickness = Math.round(20 + this.smoothedDanger * 32);
      this.heartbeatVignette.lineStyle(thickness, 0xdd1111, finalAlpha);
      this.heartbeatVignette.strokeRect(thickness / 2, thickness / 2, w - thickness, h - thickness);

      // Inner intense crimson glow ring when danger is high
      if (this.smoothedDanger > 0.35) {
        const innerAlpha = Math.min(0.7, (this.smoothedDanger - 0.35) * 0.55 * beatIntensity);
        const innerThick = Math.round(thickness * 1.4);
        this.heartbeatVignette.lineStyle(innerThick, 0x880000, innerAlpha);
        this.heartbeatVignette.strokeRect(innerThick / 2, innerThick / 2, w - innerThick, h - innerThick);
      }
    }
  }
}