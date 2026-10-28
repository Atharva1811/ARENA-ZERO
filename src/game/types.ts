import * as THREE from 'three';

export type GameState = 'MENU' | 'PLAYING' | 'PAUSED' | 'COMPLETED';

export interface CollectibleItem {
  id: string;
  name: string;
  element: 'water' | 'sun' | 'forest';
  color: string;
  glowColor: number;
  position: THREE.Vector3;
  collected: boolean;
  hint: string;
  mesh?: THREE.Group;
  light?: THREE.PointLight;
}

export interface ShrineState {
  position: THREE.Vector3;
  unlocked: boolean;
  completed: boolean;
  radius: number;
}

export interface PlayerStats {
  position: THREE.Vector3;
  speed: number;
  isMoving: boolean;
  isGrounded: boolean;
}

export interface PlayerInput {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  sprint: boolean;
  interact: boolean;
}

export interface GameSettings {
  soundEnabled: boolean;
  masterVolume: number; // 0 to 1
  sfxVolume: number;    // 0 to 1
  musicVolume: number;  // 0 to 1
  shadowsEnabled: boolean;
  mouseSensitivity: number;
  invertY: boolean;
}

export interface InteractionPrompt {
  visible: boolean;
  text: string;
  actionText?: string;
  targetId?: string;
}

export interface GameCallbacks {
  onStateChange: (state: GameState) => void;
  onCrystalCollected: (item: CollectibleItem, totalCollected: number, maxTotal: number) => void;
  onShrineUnlocked: () => void;
  onGameCompleted: (timeElapsed: number) => void;
  onInteractionPrompt: (prompt: InteractionPrompt | null) => void;
  onPlayerPositionUpdate?: (pos: THREE.Vector3, rotY: number) => void;
  onPointerLockChange?: (locked: boolean) => void;
  onNotification?: (message: string, type?: 'info' | 'success' | 'warning') => void;
}
