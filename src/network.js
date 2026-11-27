import Phaser from 'phaser';
import { sound } from './sound.js';

const DEFAULT_EXIT_GATES = [
  { id: 'east', name: 'East Airlock', x: 1840, y: 750, w: 60, h: 120 },
  { id: 'west', name: 'West Bulkhead', x: 160, y: 750, w: 60, h: 120 },
  { id: 'north', name: 'North Ventilation', x: 1000, y: 120, w: 120, h: 60 },
  { id: 'south', name: 'South Service Dock', x: 1000, y: 1380, w: 120, h: 60 }
];

export class NetworkManager {
  constructor(scene) {
    this.scene = scene;
    this.socket = scene.socket;
    this.setupEvents();
  }

  setupEvents() {
    const s = this.socket;
    const sc = this.scene;

    s.on('matchStarted', (data) => {
      sound.playMatchStart();
      sc.ui.hideGameOver();
      sc.isAlive = true;
      sc.hasEscaped = false;
      sc.taskCompleted = false;
      sc.isChanneling = false;
      sc.channelProgress = 0;
      sc.hasSentFinish = false;
      sc.channelConfirmed = false;
      sc.spectateTarget = null;
      sc.ui.setChannelProgress(false);

      // Hide mouse cursor during active gameplay & unpause
      sc.setInGameCursor(false);
      sc.isPaused = false;

      sc.playerController.stamina = 100;
      sc.playerController.anxiety = 0;
      sc.playerController.isExhausted = false;
      sc.isMatchActive = true;
      sc.canAttack = true;
      sc.attackCooldownTimer = 0;

      // Synchronize 10-minute match timer with server
      if (data && data.matchEndTime) {
        sc.matchEndTime = data.matchEndTime;
        sc.matchDuration = data.matchDuration || (10 * 60 * 1000);
        sc.matchTimeRemaining = Math.max(0, Math.ceil((data.matchEndTime - Date.now()) / 1000));
      } else {
        sc.matchDuration = 10 * 60 * 1000;
        sc.matchEndTime = Date.now() + sc.matchDuration;
        sc.matchTimeRemaining = 600;
      }

      // Clean up previous exit gates and their tweens
      if (sc.activeDoors) {
        sc.activeDoors.forEach(door => {
          if (door.rect) { sc.tweens.killTweensOf(door.rect); door.rect.destroy(); }
          if (door.text) { sc.tweens.killTweensOf(door.text); door.text.destroy(); }
          if (door.beacon) { sc.tweens.killTweensOf(door.beacon); door.beacon.destroy(); }
        });
      }
      sc.activeDoors = [];

      // Parse exit gates with complete fallback safety (array, object, or default)
      let gates = [];
      if (Array.isArray(data.exitGates) && data.exitGates.length > 0) {
        gates = data.exitGates;
      } else if (data.exitGate && typeof data.exitGate === 'object') {
        gates = [{ id: 'east', name: 'East Airlock', ...data.exitGate }];
      } else {
        gates = DEFAULT_EXIT_GATES.slice(0, 2);
      }

      // Create dynamic exit doors (hidden until terminal is bypassed)
      gates.forEach(gate => {
        // Glowing emergency beacon circle (depth 11, cuts above darkness at depth 10)
        const beacon = sc.add.circle(gate.x, gate.y, 110, 0x00ff88, 0.22)
          .setDepth(11)
          .setVisible(false);

        // Door frame rectangle (depth 12)
        const rect = sc.add.rectangle(gate.x, gate.y, gate.w || 60, gate.h || 120, 0x222222)
          .setDepth(12)
          .setVisible(false);

        // Door text banner with solid background (depth 13)
        const text = sc.add.text(gate.x, gate.y, `${gate.name.toUpperCase()}\n[LOCKED]`, {
          fontSize: '11px',
          fontFamily: 'monospace',
          fontStyle: 'bold',
          align: 'center',
          color: '#ff4444',
          backgroundColor: '#000000cc',
          padding: { x: 5, y: 3 }
        }).setOrigin(0.5).setDepth(13).setVisible(false);

        sc.activeDoors.push({
          id: gate.id,
          name: gate.name,
          x: gate.x,
          y: gate.y,
          rect,
          text,
          beacon
        });
      });

      sc.ui.spectatorBanner.setVisible(false);
      sc.ui.spectatorTip.setVisible(false);

      // Clear previous match entities
      sc.otherPlayers.clear(true, true);
      sc.footprintsGroup.clear(true, true);

      const myData = data.players[s.id];
      if (!myData) return;

      sc.role = myData.role;
      sc.player.setPosition(myData.x, myData.y);
      sc.player.setVisible(true);

      // Re-anchor camera follow to local player
      sc.cameras.main.startFollow(sc.player, true, 0.08, 0.08);

      if (sc.role === 'hunter') {
        sc.player.setFillStyle(0xe74c3c);
        sc.ui.roleText.setText('ROLE: THE HUNTER').setColor('#e74c3c');
        sc.keycardSprite.setVisible(false);
        sc.interactionPrompt.setVisible(false);
        sc.ui.taskListHeader.setVisible(false);
        sc.ui.taskItem1.setVisible(false);
        sc.ui.taskItem2.setVisible(false);
        sc.ui.attackCooldownText.setVisible(true);
      } else {
        sc.player.setFillStyle(0x2ecc71);
        sc.ui.roleText.setText('ROLE: SURVIVOR').setColor('#2ecc71');
        sc.ui.taskItem1.setText('[ ] Bypass Security Terminal').setColor('#f1c40f');
        sc.ui.taskItem2.setText('[ ] Escape Exits: Locked').setColor('#555555');
        sc.ui.taskItem3.setVisible(false);

        const myTask = data.survivorTasks[s.id];
        if (myTask) {
          sc.keycardSprite.setPosition(myTask.x, myTask.y).setVisible(true);
          sc.interactionPrompt.setPosition(myTask.x, myTask.y - 32);
        }
      }

      // Reveal role dynamically in descentOverlay
      const descentOverlay = document.getElementById('descentOverlay');
      if (descentOverlay) {
        const isHunter = (sc.role === 'hunter');
        descentOverlay.innerHTML = `
          <div class="w-16 h-16 border-4 ${isHunter ? 'border-[#ff3333]' : 'border-[#4fffe3]'} border-t-transparent rounded-full animate-spin mb-6"></div>
          <div class="text-xs tracking-[0.35em] uppercase ${isHunter ? 'text-[#ff6666]' : 'text-[#8cb2d6]'} mb-2">YOU ARE</div>
          <h2 class="font-gothic-title text-4xl sm:text-6xl tracking-widest ${isHunter ? 'text-[#ff3333]' : 'text-[#f4efe4]'} mb-4">${isHunter ? 'THE HUNTER' : 'A SURVIVOR'}</h2>
          <p class="font-codex text-sm ${isHunter ? 'text-[#ff8888]' : 'text-[#4fffe3]'} max-w-md">
            ${isHunter ? 'Eliminate all wanderers before the rituals finish.' : 'Bypass your assigned terminal and escape the facility.'}
          </p>
        `;
        descentOverlay.classList.remove('opacity-0', 'pointer-events-none');
        setTimeout(() => {
          descentOverlay.classList.add('opacity-0', 'pointer-events-none');
        }, 2000);
      }

      // Instantiate other players (including the Hunter)
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
      if (!playerInfo || playerInfo.id === s.id) return;
      let found = false;
      sc.otherPlayers.getChildren().forEach((other) => {
        if (playerInfo.id === other.playerId) {
          other.targetX = playerInfo.x;
          other.targetY = playerInfo.y;
          if (playerInfo.angle !== undefined) {
            other.targetAngle = playerInfo.angle;
          }
          found = true;
        }
      });
      if (!found) {
        sc.addOtherPlayer(playerInfo);
      }
    });

    s.on('channelAccepted', ({ durationMs }) => {
      if (sc.isChanneling) {
        sc.channelConfirmed = true;
        if (durationMs) sc.channelDuration = durationMs;
      }
    });

    s.on('channelRejected', () => {
      if (sc.isChanneling) {
        sc.isChanneling = false;
        sc.channelProgress = 0;
        sc.hasSentFinish = false;
        sc.channelConfirmed = false;
        sc.ui.setChannelProgress(false);
      }
    });

    s.on('playerJoinedMidgame', (playerInfo) => {
      if (playerInfo && playerInfo.id !== s.id) {
        sc.addOtherPlayer(playerInfo);
      }
    });

    const removeOtherPlayer = (data) => {
      const targetId = (typeof data === 'object' && data?.id) ? data.id : data;
      if (!targetId) return;

      const toRemove = [];
      sc.otherPlayers.getChildren().forEach((other) => {
        if (other.playerId === targetId || (typeof data === 'object' && data.name && other.playerName === data.name)) {
          toRemove.push(other);
        }
      });

      toRemove.forEach((other) => {
        sc.otherPlayers.remove(other, true, true);
      });
    };

    s.on('playerDisconnected', removeOtherPlayer);
    s.on('playerLeft', removeOtherPlayer);

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
      sound.playHit();
      sc.cameras.main.flash(200, 180, 0, 0);
    });

    s.on('personalTaskDone', () => {
      sound.playTaskComplete();
      sound.playGateUnlocked();
      sc.taskCompleted = true;
      sc.isChanneling = false;
      sc.channelProgress = 0;
      sc.hasSentFinish = false;
      sc.channelConfirmed = false;
      sc.ui.setChannelProgress(false);
      sc.keycardSprite.setVisible(false);
      sc.interactionPrompt.setVisible(false);

      // Reveal & power up all active exit doors
      if (sc.activeDoors && sc.activeDoors.length > 0) {
        sc.activeDoors.forEach(door => {
          door.rect.setFillStyle(0x27ae60).setVisible(true).setAlpha(1);
          door.text.setText(`${door.name.toUpperCase()}\n[OPEN]`).setColor('#00ff88').setVisible(true).setAlpha(1);
          if (door.beacon) door.beacon.setVisible(true).setAlpha(0.28);

          // Pulsing glow tween to clearly signal powered gates
          sc.tweens.add({
            targets: [door.rect, door.text],
            alpha: { from: 0.55, to: 1.0 },
            duration: 650,
            yoyo: true,
            repeat: -1
          });

          if (door.beacon) {
            sc.tweens.add({
              targets: door.beacon,
              scale: { from: 0.9, to: 1.25 },
              alpha: { from: 0.15, to: 0.35 },
              duration: 800,
              yoyo: true,
              repeat: -1
            });
          }
        });
      }

      sc.ui.taskItem1.setText('[✓] Security Terminal Bypassed').setColor('#2ecc71');
      const doorSummary = (sc.activeDoors && sc.activeDoors.length > 0)
        ? sc.activeDoors.map(d => d.name).join(' OR ')
        : 'ANY EXIT';
      sc.ui.taskItem2.setText(`[!] REACH EXIT: ${doorSummary}`).setColor('#00ff88');
    });

    s.on('youEscaped', () => {
      sound.playVictory();
      sc.hasEscaped = true;
      sc.setInGameCursor(true);
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
        sound.playDead();
        sc.isAlive = false;
        sc.setInGameCursor(true);
        sc.isChanneling = false;
        sc.channelProgress = 0;
        sc.hasSentFinish = false;
        sc.channelConfirmed = false;
        sc.ui.setChannelProgress(false);
        sc.player.setFillStyle(0x444444);
        sc.ui.showEliminated();
        sc.cycleSpectateTarget();
      } else {
        sound.playScream();
        sc.otherPlayers.getChildren().forEach((other) => {
          if (other.playerId === victimId) {
            other.setFillStyle(0x444444);
            other.isAlive = false;
          }
        });
      }
    });

    s.on('gameOver', (data) => {
      if (data.winner === sc.role) {
        sound.playVictory();
      } else {
        sound.playGameOver();
      }

      sc.isMatchActive = false;
      sc.isPaused = false;
      sc.matchEndTime = null;
      sc.matchTimeRemaining = 0;
      sc.setInGameCursor(true);
      sc.player.body.setVelocity(0);
      sc.ui.heartbeatVignette.clear();
      sc.ui.setChannelProgress(false);

      const bannerColor = data.winner === 'survivor' ? '#2ecc71' : '#e74c3c';
      sc.ui.showGameOver(data.message, bannerColor);
    });

    s.on('returnToLobby', (data) => {
      if (data && data.roomCode) {
        sc.currentRoomCode = data.roomCode;
      }
      sc.returnToLobby();
    });
  }

  sendMovement(x, y, angle, isSprinting) {
    if (this.socket && this.socket.connected) {
      this.socket.emit('playerMovement', { x, y, angle, isSprinting });
    }
  }
}