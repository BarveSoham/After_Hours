export class NetworkManager {
  constructor(scene) {
    this.scene = scene;
    this.socket = scene.socket;
    this.setupEvents();
  }

  setupEvents() {
    const s = this.socket;
    const sc = this.scene;

    s.on('lobbyUpdate', (lobby) => {
      if (lobby.gameState === 'waiting') {
        sc.isMatchActive = false;
        sc.ui.roleText.setText(`WAITING FOR PLAYERS (${lobby.count}/${lobby.required})...`).setColor('#f1c40f');
        sc.ui.taskListHeader.setVisible(false);
        sc.ui.taskItem1.setVisible(false);
        sc.ui.taskItem2.setVisible(false);
        sc.ui.spectatorBanner.setVisible(false);
        sc.ui.spectatorTip.setVisible(false);
        sc.ui.hideGameOver();
        sc.player.setFillStyle(0x888888);
      }
    });

    s.on('matchStarted', (data) => {
      sc.ui.hideGameOver();
      sc.isAlive = true;
      sc.hasEscaped = false;
      sc.taskCompleted = false;
      sc.isChanneling = false;
      sc.channelProgress = 0;
      sc.spectateTarget = null;
      sc.ui.setChannelProgress(false);

      sc.playerController.stamina = 100;
      sc.playerController.anxiety = 0;
      sc.playerController.isExhausted = false;
      sc.isMatchActive = true;
      sc.canAttack = true;
      sc.attackCooldownTimer = 0;

      // Lock gate visually
      sc.exitDoor.setFillStyle(0x444444);
      sc.exitDoorText.setText('EXIT\n[LOCKED]').setColor('#ff4444');

      sc.ui.spectatorBanner.setVisible(false);
      sc.ui.spectatorTip.setVisible(false);
      sc.ui.taskItem1.setText('[ ] Bypass Security Terminal').setColor('#f1c40f');
      sc.ui.taskItem2.setText('[ ] Escape Through Exit').setColor('#555555');

      sc.otherPlayers.clear(true, true);
      sc.footprintsGroup.clear(true, true);

      const myData = data.players[s.id];
      if (!myData) return;

      sc.role = myData.role;
      sc.player.setPosition(myData.x, myData.y);
      sc.player.setVisible(true);

      // Rebind camera to local player on start
      sc.cameras.main.startFollow(sc.player, true, 0.08, 0.08);

      if (sc.role === 'hunter') {
        sc.player.setFillStyle(0xe74c3c);
        sc.ui.roleText.setText('ROLE: THE HUNTER').setColor('#e74c3c');
        sc.keycardSprite.setVisible(false);
        sc.interactionPrompt.setVisible(false);
      } else {
        sc.player.setFillStyle(0x2ecc71);
        sc.ui.roleText.setText('ROLE: SURVIVOR').setColor('#2ecc71');

        const myTask = data.survivorTasks[s.id];
        if (myTask) {
          sc.keycardSprite.setPosition(myTask.x, myTask.y).setVisible(true);
          sc.interactionPrompt.setPosition(myTask.x, myTask.y - 32);
        }
      }

      Object.keys(data.players).forEach((id) => {
        if (id !== s.id) {
          sc.addOtherPlayer(data.players[id]);
        }
      });

      s.emit('playerMovement', {
        x: sc.player.x,
        y: sc.player.y,
        angle: 0,
        isSprinting: false
      });
    });

    s.on('playerMoved', (playerInfo) => {
      sc.otherPlayers.getChildren().forEach((other) => {
        if (playerInfo.id === other.playerId) {
          other.targetX = playerInfo.x;
          other.targetY = playerInfo.y;
          other.setAngle(playerInfo.angle);
        }
      });
    });

    s.on('playerDisconnected', (playerId) => {
      sc.otherPlayers.getChildren().forEach((other) => {
        if (playerId === other.playerId) other.destroy();
      });
    });

    s.on('spawnFootprint', (data) => {
      if (sc.role === 'hunter') {
        const footprint = sc.add.ellipse(data.x, data.y, 10, 6, 0x00ffff, 0.85);
        footprint.setAngle(data.angle).setDepth(2);
        sc.footprintsGroup.add(footprint);

        sc.tweens.add({
          targets: footprint,
          alpha: 0,
          scale: 0.6,
          duration: 3200,
          ease: 'Linear',
          onComplete: () => footprint.destroy()
        });
      }
    });

    s.on('attackExecuted', (data) => {
      sc.canAttack = false;
      sc.attackCooldownDuration = data.cooldownMs;
      sc.attackCooldownTimer = data.cooldownMs;
    });

    s.on('hunterHitEffect', () => {
      sc.cameras.main.flash(200, 180, 0, 0);
    });

    s.on('personalTaskDone', () => {
      sc.taskCompleted = true;
      sc.isChanneling = false;
      sc.ui.setChannelProgress(false);
      sc.keycardSprite.setVisible(false);
      sc.interactionPrompt.setVisible(false);

      sc.exitDoor.setFillStyle(0x27ae60);
      sc.exitDoorText.setText('EXIT\n[OPEN]').setColor('#ffffff');

      sc.ui.taskItem1.setText('[✓] Security Terminal Bypassed').setColor('#2ecc71');
      sc.ui.taskItem2.setText('[ ] Reach the EXIT').setColor('#00ff88');
    });

    s.on('youEscaped', () => {
      sc.hasEscaped = true;
      sc.player.setVisible(false);
      sc.ui.showEscaped();
      sc.cycleSpectateTarget();
    });

    s.on('survivorEscapedNotification', ({ id }) => {
      sc.otherPlayers.getChildren().forEach((other) => {
        if (other.playerId === id) other.destroy();
      });
    });

    s.on('survivorEliminated', ({ victimId }) => {
      if (s.id === victimId) {
        sc.isAlive = false;
        sc.isChanneling = false;
        sc.ui.setChannelProgress(false);
        sc.player.setFillStyle(0x444444);
        sc.ui.showEliminated();
        sc.cycleSpectateTarget();
      } else {
        sc.otherPlayers.getChildren().forEach((other) => {
          if (other.playerId === victimId) {
            other.setFillStyle(0x444444);
            other.isAlive = false;
          }
        });
      }
    });

    s.on('gameOver', (data) => {
      sc.isMatchActive = false;
      sc.player.body.setVelocity(0);
      sc.ui.heartbeatVignette.clear();
      sc.ui.setChannelProgress(false);

      const bannerColor = data.winner === 'survivor' ? '#2ecc71' : '#e74c3c';
      sc.ui.showGameOver(data.message, bannerColor);
    });
  }

  sendMovement(x, y, angle, isSprinting) {
    if (this.socket && this.socket.connected) {
      this.socket.emit('playerMovement', { x, y, angle, isSprinting });
    }
  }
}