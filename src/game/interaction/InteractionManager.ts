import * as THREE from 'three';
import type { CollectibleItem, GameCallbacks, InteractionPrompt } from '../types';
import type { WorldObjects } from '../world/WorldBuilder';
import { SoundManager } from '../audio/SoundManager';

export class InteractionManager {
  private activePrompt: InteractionPrompt | null = null;
  private currentTarget: { type: 'crystal'; item: CollectibleItem } | { type: 'shrine' } | null = null;
  private collectedCount: number = 0;
  private maxCrystals: number = 3;

  private world: WorldObjects;
  private soundManager: SoundManager;
  private callbacks: GameCallbacks;

  constructor(
    world: WorldObjects,
    soundManager: SoundManager,
    callbacks: GameCallbacks
  ) {
    this.world = world;
    this.soundManager = soundManager;
    this.callbacks = callbacks;
    this.maxCrystals = this.world.collectibles.length;
  }

  public getCollectedCount(): number {
    return this.collectedCount;
  }

  public checkProximity(playerPos: THREE.Vector3) {
    let nearestPrompt: InteractionPrompt | null = null;
    let targetFound: { type: 'crystal'; item: CollectibleItem } | { type: 'shrine' } | null = null;

    // 1. Check Crystals
    for (const crystal of this.world.collectibles) {
      if (!crystal.collected) {
        const dist = playerPos.distanceTo(crystal.position);
        if (dist <= 2.6) {
          nearestPrompt = {
            visible: true,
            text: `Collect ${crystal.name}`,
            actionText: 'Press [E]',
            targetId: crystal.id,
          };
          targetFound = { type: 'crystal', item: crystal };
          break; // Priority to closest crystal in range
        }
      }
    }

    // 2. Check Shrine if no crystal in range
    if (!nearestPrompt) {
      const shrinePos = this.world.shrine.position;
      const dist = Math.hypot(playerPos.x - shrinePos.x, playerPos.z - shrinePos.z);

      if (dist <= this.world.shrine.radius) {
        if (!this.world.shrine.unlocked) {
          nearestPrompt = {
            visible: true,
            text: `Solis Shrine Sealed (${this.collectedCount}/${this.maxCrystals} Crystals)`,
            actionText: 'Find Crystals',
          };
        } else if (!this.world.shrine.completed) {
          nearestPrompt = {
            visible: true,
            text: 'Awaken the Ancient Solis Shrine!',
            actionText: 'Press [E]',
          };
          targetFound = { type: 'shrine' };
        } else {
          nearestPrompt = {
            visible: true,
            text: 'Solis Shrine radiates eternal harmony.',
            actionText: 'Shrine Awakened',
          };
        }
      }
    }

    // Only update callback when prompt state changes to avoid unnecessary render spam
    if (
      (!this.activePrompt && nearestPrompt) ||
      (this.activePrompt && !nearestPrompt) ||
      (this.activePrompt && nearestPrompt && (this.activePrompt.text !== nearestPrompt.text || this.activePrompt.actionText !== nearestPrompt.actionText))
    ) {
      this.activePrompt = nearestPrompt;
      this.callbacks.onInteractionPrompt(nearestPrompt);
    }

    this.currentTarget = targetFound;
  }

  public interact(): boolean {
    if (!this.currentTarget) return false;

    if (this.currentTarget.type === 'crystal') {
      const item = this.currentTarget.item;
      if (item.collected) return false;

      // Collect crystal
      item.collected = true;
      this.collectedCount++;

      // Remove 3D mesh
      this.world.removeCollectibleMesh(item.id);

      // Sound effect with escalating pitch
      this.soundManager.playCrystalPickup(this.collectedCount - 1);

      // Notify callback
      this.callbacks.onCrystalCollected(item, this.collectedCount, this.maxCrystals);
      this.callbacks.onNotification?.(`Found ${item.name}! (${this.collectedCount}/${this.maxCrystals})`, 'success');

      // Check if all crystals collected
      if (this.collectedCount >= this.maxCrystals && !this.world.shrine.unlocked) {
        this.world.unlockShrineVisuals();
        this.soundManager.playShrineUnlocked();
        this.callbacks.onShrineUnlocked();
        this.callbacks.onNotification?.('All Elemental Crystals collected! The Solis Shrine is unsealed!', 'info');
      }

      this.activePrompt = null;
      this.currentTarget = null;
      this.callbacks.onInteractionPrompt(null);
      return true;
    }

    if (this.currentTarget.type === 'shrine') {
      if (this.world.shrine.unlocked && !this.world.shrine.completed) {
        this.world.completeShrineVisuals();
        this.soundManager.playVictoryFanfare();
        this.callbacks.onGameCompleted(0); // Time is handled in GameEngine
        this.activePrompt = null;
        this.currentTarget = null;
        this.callbacks.onInteractionPrompt(null);
        return true;
      }
    }

    return false;
  }

  public reset() {
    this.collectedCount = 0;
    this.activePrompt = null;
    this.currentTarget = null;
    this.world.shrine.unlocked = false;
    this.world.shrine.completed = false;

    // Reset collectibles status
    this.world.collectibles.forEach((c) => {
      c.collected = false;
    });

    this.callbacks.onInteractionPrompt(null);
  }
}
