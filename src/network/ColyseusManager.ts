import { Client, Room } from 'colyseus.js';
import type {
  JoinRoomOptions,
  PlayerInputPayload,
  FireWeaponPayload,
  HitConfirmPayload,
  DamageReceivedPayload,
  KillFeedItem,
  WeaponTracerEvent,
  MatchWinnerPayload,
} from '../../shared/types';

export class ColyseusManager {
  private client: Client;
  public room: Room | null = null;
  public mySessionId: string = '';
  public isConnected: boolean = false;
  private serverUrl: string = '';

  // Reconnection tracking
  private lastRoomId: string = '';
  private reconnectionToken: string = '';
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 3;
  private isReconnecting: boolean = false;
  private manualLeaveRequested: boolean = false;

  public get reconnecting(): boolean {
    return this.isReconnecting;
  }

  // Callbacks
  public onStateChange?: (state: any) => void;
  public onPlayerAdd?: (player: any, key: string) => void;
  public onPlayerRemove?: (player: any, key: string) => void;
  public onHitConfirm?: (data: HitConfirmPayload) => void;
  public onDamageReceived?: (data: DamageReceivedPayload) => void;
  public onKillFeed?: (data: KillFeedItem) => void;
  public onWeaponTracer?: (data: WeaponTracerEvent) => void;
  public onRespawnConfirmed?: (data: { x: number; y: number; z: number; yaw: number }) => void;
  public onMatchOver?: (data: MatchWinnerPayload) => void;
  public onAnnouncement?: (data: { message: string }) => void;
  public onError?: (err: string) => void;
  public onDisconnect?: () => void;
  public onReconnecting?: (attempt: number, maxAttempts: number) => void;
  public onReconnected?: () => void;

  constructor() {
    this.serverUrl = this.resolveServerUrl();
    this.client = new Client(this.serverUrl);
  }

  public getServerUrl(): string {
    return this.serverUrl;
  }

  private resolveServerUrl(): string {
    // 1. Check Vite environment variable
    const envUrl = import.meta.env.VITE_GAME_SERVER_URL;
    if (envUrl && typeof envUrl === 'string' && envUrl.trim().length > 0) {
      return envUrl.trim();
    }

    // 2. Localhost fallback
    const hostname = window.location.hostname || 'localhost';
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
      return `ws://${hostname}:2567`;
    }

    // 3. Fallback for public demo hosting or custom deployment
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}`;
  }

  public async joinPublic(nickname: string): Promise<Room> {
    const options: JoinRoomOptions = { nickname };
    return this.connect(() => this.client.joinOrCreate('arena_public', options));
  }

  public async createPrivate(nickname: string): Promise<Room> {
    const options: JoinRoomOptions = { nickname, isPrivate: true };
    return this.connect(() => this.client.create('arena_private', options));
  }

  public async joinPrivate(nickname: string, roomCode: string): Promise<Room> {
    const options: JoinRoomOptions = { nickname, roomCode: roomCode.trim().toUpperCase() };
    return this.connect(() => this.client.joinOrCreate('arena_private', options));
  }

  private async connect(connectFn: () => Promise<Room>): Promise<Room> {
    try {
      this.leave(); // Leave any previous room
      this.manualLeaveRequested = false;
      this.reconnectAttempts = 0;
      this.isReconnecting = false;

      const room = await connectFn();
      this.room = room;
      this.mySessionId = room.sessionId;
      this.lastRoomId = room.id;
      this.reconnectionToken = room.reconnectionToken;
      this.isConnected = true;

      this.setupRoomListeners(room);
      return room;
    } catch (err: any) {
      this.isConnected = false;
      const msg = err?.message || 'Failed to connect to game server. Is the server online?';
      this.onError?.(msg);
      throw new Error(msg);
    }
  }

  private setupRoomListeners(room: Room) {
    // Sync state
    room.onStateChange((state) => {
      this.onStateChange?.(state);
    });

    // Players collection change events
    const attachPlayerListeners = (state: any) => {
      if (state && state.players) {
        state.players.onAdd((player: any, key: string) => {
          this.onPlayerAdd?.(player, key);
        });
        state.players.onRemove((player: any, key: string) => {
          this.onPlayerRemove?.(player, key);
        });
      }
    };

    if (room.state && room.state.players) {
      attachPlayerListeners(room.state);
    } else {
      room.onStateChange.once((state) => {
        attachPlayerListeners(state);
      });
    }

    // Custom Server Broadcast Messages
    room.onMessage('hit_confirm', (data: HitConfirmPayload) => {
      this.onHitConfirm?.(data);
    });

    room.onMessage('damage_received', (data: DamageReceivedPayload) => {
      this.onDamageReceived?.(data);
    });

    room.onMessage('kill_feed', (data: KillFeedItem) => {
      this.onKillFeed?.(data);
    });

    room.onMessage('weapon_tracer', (data: WeaponTracerEvent) => {
      this.onWeaponTracer?.(data);
    });

    room.onMessage('respawn_confirmed', (data: { x: number; y: number; z: number; yaw: number }) => {
      this.onRespawnConfirmed?.(data);
    });

    room.onMessage('match_over', (data: MatchWinnerPayload) => {
      this.onMatchOver?.(data);
    });

    room.onMessage('server_announcement', (data: { message: string }) => {
      this.onAnnouncement?.(data);
    });

    room.onLeave((code) => {
      console.log(`[ColyseusManager] Disconnected from room with code: ${code}`);

      // If user manually left or intentional server disconnect
      if (this.manualLeaveRequested || code === 1000 || code === 4000) {
        this.isConnected = false;
        this.room = null;
        this.manualLeaveRequested = false;
        this.onDisconnect?.();
        return;
      }

      // If we have reconnection token and have retries remaining, attempt bounded reconnection
      if (this.lastRoomId && this.reconnectionToken && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.isReconnecting = true;
        this.reconnectAttempts++;
        const backoffMs = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts - 1), 4000);
        console.log(`[ColyseusManager] Network dropped (${code}). Reconnecting ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${backoffMs}ms...`);
        this.onReconnecting?.(this.reconnectAttempts, this.maxReconnectAttempts);

        setTimeout(async () => {
          if (this.manualLeaveRequested) return;
          try {
            const reconnectedRoom = await this.client.reconnect(this.reconnectionToken);
            this.room = reconnectedRoom;
            this.mySessionId = reconnectedRoom.sessionId;
            this.reconnectionToken = reconnectedRoom.reconnectionToken;
            this.isConnected = true;
            this.isReconnecting = false;
            this.reconnectAttempts = 0;
            this.setupRoomListeners(reconnectedRoom);
            console.log(`[ColyseusManager] Successfully reconnected to room!`);
            this.onReconnected?.();
          } catch (reconnectErr) {
            console.warn('[ColyseusManager] Reconnection attempt failed:', reconnectErr);
            if (this.reconnectAttempts >= this.maxReconnectAttempts) {
              this.isConnected = false;
              this.room = null;
              this.isReconnecting = false;
              this.onDisconnect?.();
            }
          }
        }, backoffMs);
        return;
      }

      this.isConnected = false;
      this.room = null;
      this.isReconnecting = false;
      this.onDisconnect?.();
    });

    room.onError((code, message) => {
      console.warn(`[ColyseusManager] Room error [${code}]:`, message);
      this.onError?.(`Server Error [${code}]: ${message}`);
    });
  }

  // --- CLIENT ACTIONS (WITH SAFE TRY/CATCH) ---

  public sendMove(payload: PlayerInputPayload) {
    if (this.room && this.isConnected) {
      try {
        this.room.send('move', payload);
      } catch (e) {
        console.warn('[ColyseusManager] Error sending move:', e);
      }
    }
  }

  public sendFire(payload: FireWeaponPayload) {
    if (this.room && this.isConnected) {
      try {
        this.room.send('fire', payload);
      } catch (e) {
        console.warn('[ColyseusManager] Error sending fire:', e);
      }
    }
  }

  public sendReload() {
    if (this.room && this.isConnected) {
      try {
        this.room.send('reload');
      } catch (e) {
        console.warn('[ColyseusManager] Error sending reload:', e);
      }
    }
  }

  public sendRespawnRequest() {
    if (this.room && this.isConnected) {
      try {
        this.room.send('respawn_request');
      } catch (e) {
        console.warn('[ColyseusManager] Error sending respawn_request:', e);
      }
    }
  }

  public leave() {
    this.manualLeaveRequested = true;
    this.reconnectAttempts = this.maxReconnectAttempts;
    this.isReconnecting = false;
    if (this.room) {
      try {
        this.room.leave();
      } catch {}
      this.room = null;
    }
    this.isConnected = false;
  }
}
