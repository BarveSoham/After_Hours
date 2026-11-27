import Phaser from 'phaser';
import { sound } from './sound.js';

export class PlayerController {
  constructor(scene) {
    this.scene = scene;

    // Movement speeds & stats
    this.walkSpeed = 180;
    this.sprintSpeed = 310;
    this.stamina = 100;
    this.maxStamina = 100;
    this.anxiety = 0;
    this.maxAnxiety = 100;
    this.isExhausted = false;

    // Local inputs
    this.wasd = scene.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D
    });
    this.shiftKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.interactKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);

    this.isSprinting = false;
  }

  update(dt, isChanneling) {
    // If locally paused, freeze local player but continue smoothing remote players
    if (this.scene.isPaused) {
      this.scene.player.body.setVelocity(0, 0);
      this.scene.otherPlayers.getChildren().forEach((other) => {
        if (other.targetX !== undefined) {
          other.x = Phaser.Math.Linear(other.x, other.targetX, Math.min(1, 22 * dt));
          other.y = Phaser.Math.Linear(other.y, other.targetY, Math.min(1, 22 * dt));
        }
      });
      return;
    }

    let vx = 0;
    let vy = 0;

    if (!isChanneling) {
      if (this.wasd.left.isDown) vx -= 1;
      if (this.wasd.right.isDown) vx += 1;
      if (this.wasd.up.isDown) vy -= 1;
      if (this.wasd.down.isDown) vy += 1;
    }

    const isMoving = (vx !== 0 || vy !== 0);
    let currentSpeed = this.walkSpeed;

    // Survivor sprint mechanics
    if (this.scene.role === 'survivor' && !isChanneling) {
      // If already sprinting, allow continuing smoothly until stamina reaches 0
      // If initiating a new sprint, require not being exhausted and at least 10 stamina
      const canContinueSprint = this.isSprinting && this.shiftKey.isDown && isMoving && !this.isExhausted && this.stamina > 0;
      const canStartSprint = !this.isExhausted && this.shiftKey.isDown && isMoving && this.stamina >= 10;

      if (canContinueSprint || canStartSprint) {
        this.isSprinting = true;
        currentSpeed = this.sprintSpeed;
        this.stamina = Math.max(0, this.stamina - 28 * dt);
        this.anxiety = Math.min(this.maxAnxiety, this.anxiety + 3 * dt);

        if (this.stamina <= 0) {
          this.stamina = 0;
          this.isExhausted = true;
          this.isSprinting = false;
          currentSpeed = this.walkSpeed;
        }
      } else {
        this.isSprinting = false;
        // Stamina regenerates when walking or idle (faster when idle)
        this.stamina = Math.min(this.maxStamina, this.stamina + (isMoving ? 12 : 22) * dt);
        // Survivor must recover to at least 30% stamina before exhaustion clears
        if (this.isExhausted && this.stamina >= 30) {
          this.isExhausted = false;
        }
      }
      this.anxiety = Math.min(this.maxAnxiety, this.anxiety + 0.8 * dt);
    } else if (this.scene.role === 'hunter') {
      this.isSprinting = false;
      currentSpeed = 230;
    } else {
      this.isSprinting = false;
    }

    // Normalized diagonal velocity vector
    if (isMoving && !isChanneling) {
      const moveVec = new Phaser.Math.Vector2(vx, vy).normalize().scale(currentSpeed);
      this.scene.player.body.setVelocity(moveVec.x, moveVec.y);

      // Play procedural footsteps during active gameplay
      if (this.scene.isMatchActive && this.scene.isAlive && !this.scene.hasEscaped) {
        // Context-aware surface detection
        if (this.scene.player.x >= 1400 && this.scene.player.y <= 500) {
          sound.setSurface('wood');
        } else if (this.scene.player.x <= 500 && this.scene.player.y >= 1000) {
          sound.setSurface('gravel');
        } else {
          sound.setSurface('stone');
        }

        if (this.isSprinting) {
          sound.playRunStep();
        } else {
          sound.playWalkStep();
        }
      }
    } else {
      this.scene.player.body.setVelocity(0, 0);
    }

    // Smoothly glide remote players toward target positions (continuous flow, zero stutter)
    this.scene.otherPlayers.getChildren().forEach((other) => {
      if (other.targetX !== undefined) {
        const dist = Phaser.Math.Distance.Between(other.x, other.y, other.targetX, other.targetY);
        if (dist > 180) {
          // Snap if too far (teleport, respawn, map boundary)
          other.x = other.targetX;
          other.y = other.targetY;
        } else if (dist > 0.05) {
          // Frame-rate independent exponential smoothing: fluid motion, never micro-stutters mid-step
          const lerpFactor = 1 - Math.exp(-22 * dt);
          other.x += (other.targetX - other.x) * lerpFactor;
          other.y += (other.targetY - other.y) * lerpFactor;
        }

        // Smooth rotation angle interpolation
        if (other.targetAngle !== undefined) {
          const diff = Phaser.Math.Angle.WrapDegrees(other.targetAngle - other.angle);
          if (Math.abs(diff) > 0.5) {
            const rotFactor = 1 - Math.exp(-20 * dt);
            other.setAngle(other.angle + diff * rotFactor);
          }
        }
      }
    });
  }
}