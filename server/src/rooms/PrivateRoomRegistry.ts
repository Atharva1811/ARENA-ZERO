import crypto from 'crypto';
import type { ArenaRoom } from './ArenaRoom.js';

export interface PrivateRoomEntry {
  roomId: string;
  room: ArenaRoom;
  code: string;
  createdAt: number;
}

export class PrivateRoomRegistry {
  private static _instance: PrivateRoomRegistry;

  public static get instance(): PrivateRoomRegistry {
    if (!this._instance) {
      this._instance = new PrivateRoomRegistry();
    }
    return this._instance;
  }

  // Maps 4-digit code ('0000' to '9999') -> room entry
  private codeToRoom: Map<string, PrivateRoomEntry> = new Map();

  // Maps Colyseus roomId -> 4-digit code
  private roomIdToCode: Map<string, string> = new Map();

  // Failed attempts tracking for brute-force prevention: identifier -> { count, firstAttempt }
  private failedAttempts: Map<string, { count: number; firstAttempt: number }> = new Map();

  public readonly MAX_CODES = 10000;
  public readonly MAX_ATTEMPTS = 200;
  public readonly MAX_FAILED_ATTEMPTS = 5;
  public readonly RATE_LIMIT_WINDOW_MS = 30000; // 30 seconds

  /**
   * Generates a cryptographically secure 4-digit numeric string ('0000' - '9999')
   */
  public generateCode(): string {
    const num = crypto.randomInt(0, 10000);
    return num.toString().padStart(4, '0');
  }

  /**
   * Authoritatively allocates a unique 4-digit room code and binds it to the room.
   */
  public allocate(room: ArenaRoom): string {
    // If room already has an allocated code, reuse it
    const existing = this.roomIdToCode.get(room.roomId);
    if (existing) {
      return existing;
    }

    if (this.codeToRoom.size >= this.MAX_CODES - 100) {
      throw new Error('Maximum private room capacity reached (no available 4-digit codes).');
    }

    let code = '';
    let found = false;

    // Fast-path: random generation with collision checks
    for (let i = 0; i < this.MAX_ATTEMPTS; i++) {
      const candidate = this.generateCode();
      if (!this.codeToRoom.has(candidate)) {
        code = candidate;
        found = true;
        break;
      }
    }

    // Fallback: deterministic scan if random selection repeatedly collided
    if (!found) {
      const startOffset = crypto.randomInt(0, 10000);
      for (let i = 0; i < this.MAX_CODES; i++) {
        const candidate = ((startOffset + i) % this.MAX_CODES).toString().padStart(4, '0');
        if (!this.codeToRoom.has(candidate)) {
          code = candidate;
          found = true;
          break;
        }
      }
    }

    if (!code) {
      throw new Error('No available private room codes.');
    }

    const entry: PrivateRoomEntry = {
      roomId: room.roomId,
      room,
      code,
      createdAt: Date.now(),
    };

    this.codeToRoom.set(code, entry);
    this.roomIdToCode.set(room.roomId, code);

    return code;
  }

  /**
   * Release a code when a private room is disposed.
   */
  public release(roomIdOrCode: string): void {
    if (this.codeToRoom.has(roomIdOrCode)) {
      const entry = this.codeToRoom.get(roomIdOrCode);
      if (entry) {
        this.roomIdToCode.delete(entry.roomId);
      }
      this.codeToRoom.delete(roomIdOrCode);
    } else if (this.roomIdToCode.has(roomIdOrCode)) {
      const code = this.roomIdToCode.get(roomIdOrCode);
      if (code) {
        this.codeToRoom.delete(code);
      }
      this.roomIdToCode.delete(roomIdOrCode);
    }
  }

  public getByCode(code: string): PrivateRoomEntry | undefined {
    return this.codeToRoom.get(code);
  }

  public getByRoomId(roomId: string): string | undefined {
    return this.roomIdToCode.get(roomId);
  }

  public checkRateLimit(identifier: string): { allowed: boolean; retryAfterSec?: number } {
    const now = Date.now();
    const entry = this.failedAttempts.get(identifier);
    if (!entry) return { allowed: true };

    if (now - entry.firstAttempt > this.RATE_LIMIT_WINDOW_MS) {
      this.failedAttempts.delete(identifier);
      return { allowed: true };
    }

    if (entry.count >= this.MAX_FAILED_ATTEMPTS) {
      const remainingMs = this.RATE_LIMIT_WINDOW_MS - (now - entry.firstAttempt);
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil(remainingMs / 1000)),
      };
    }

    return { allowed: true };
  }

  public recordFailedAttempt(identifier: string): void {
    const now = Date.now();
    const entry = this.failedAttempts.get(identifier);
    if (!entry || now - entry.firstAttempt > this.RATE_LIMIT_WINDOW_MS) {
      this.failedAttempts.set(identifier, { count: 1, firstAttempt: now });
    } else {
      entry.count++;
    }
  }

  public resetFailedAttempts(identifier: string): void {
    this.failedAttempts.delete(identifier);
  }

  public getActiveCount(): number {
    return this.codeToRoom.size;
  }

  public clear(): void {
    this.codeToRoom.clear();
    this.roomIdToCode.clear();
    this.failedAttempts.clear();
  }
}

