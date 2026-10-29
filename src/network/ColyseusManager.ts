import { Client, Room } from 'colyseus.js';
import { GAME_CONSTANTS } from '../../shared/constants';
import type {
  JoinRoomOptions,
  PlayerInputPayload,
  FireWeaponPayload,
  HitConfirmPayload,
  DamageReceivedPayload,
  KillFeedItem,
  WeaponTracerEvent,
  MatchWinnerPayload,
  SpawnConfirmedPayload,
  WeaponId,
} from '../../shared/types';

export class ColyseusManager {
  private client: Client;
  public room: Room | null = null;
  public mySessionId: string = '';
  public isConnected: boolean = false;
  private serverUrl: string = '';
  private clientToken: string = '';
  private currentRoomEpoch: number = 0;

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
  public cachedInitSpawn?: SpawnConfirmedPayload;
  private _onInitSpawn?: (data: SpawnConfirmedPayload) => void;
  public get onInitSpawn(): ((data: SpawnConfirmedPayload) => void) | undefined {
    return this._onInitSpawn;
  }
  public set onInitSpawn(cb: ((data: SpawnConfirmedPayload) => void) | undefined) {
    this._onInitSpawn = cb;
    if (cb && this.cachedInitSpawn) {
      cb(this.cachedInitSpawn);
    }
  }
  public onRespawnConfirmed?: (data: { x: number; y: number; z: number; yaw: number }) => void;
  public onMatchOver?: (data: MatchWinnerPayload) => void;
  public onAnnouncement?: (data: { message: string }) => void;
  public onError?: (err: string) => void;
  public onDisconnect?: () => void;
  public onReconnecting?: (attempt: number, maxAttempts: number) => void;
  public onReconnected?: () => void;
  public onMatchmakingStatus?: (status: 'searching' | 'found' | 'connecting') => void;

  constructor() {
    this.clientToken = this.getOrCreateClientToken();
    this.serverUrl = this.resolveServerUrl();
    this.client = new Client(this.serverUrl);
  }

  private getOrCreateClientToken(): string {
    try {
      let token = sessionStorage.getItem('arena_zero_client_token');
      if (!token) {
        token = 'az-' + Math.random().toString(36).substring(2, 12) + '-' + Date.now().toString(36);
        sessionStorage.setItem('arena_zero_client_token', token);
      }
      return token;
    } catch {
      return 'az-' + Math.random().toString(36).substring(2, 12);
    }
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

  public getHttpServerUrl(): string {
    const wsUrl = this.getServerUrl();
    return wsUrl.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
  }

  public async joinPublic(nickname: string): Promise<Room> {
    const options: JoinRoomOptions = { nickname, clientToken: this.clientToken };

    return this.connect(async () => {
      this.onMatchmakingStatus?.('searching');

      try {
        // Query active public rooms from Colyseus listing
        const availableRooms = await this.client.getAvailableRooms('arena_public');

        // Find an open, non-full, non-finished public room
        const eligible = availableRooms.find((r) => {
          const max = r.maxClients || GAME_CONSTANTS.ROOM_CAPACITY;
          const notFull = r.clients < max;
          const notPrivate = !r.metadata?.isPrivate;
          const notFinished = r.metadata?.status !== 'finished';
          return notFull && notPrivate && notFinished;
        });

        if (eligible) {
          this.onMatchmakingStatus?.('found');
          try {
            return await this.client.joinById(eligible.roomId, options);
          } catch (joinByIdErr) {
            console.warn('[ColyseusManager] joinById failed (room may have filled), falling back to joinOrCreate:', joinByIdErr);
          }
        }
      } catch (getRoomsErr) {
        console.warn('[ColyseusManager] getAvailableRooms failed, falling back to joinOrCreate:', getRoomsErr);
      }

      this.onMatchmakingStatus?.('connecting');
      return await this.client.joinOrCreate('arena_public', options);
    });
  }

  public async createPrivate(nickname: string): Promise<Room> {
    const options: JoinRoomOptions = { nickname, isPrivate: true, clientToken: this.clientToken };
    return this.connect(() => this.client.create('arena_private', options));
  }

  public async joinPrivate(nickname: string, roomCode: string): Promise<Room> {
    const cleanCode = roomCode.trim();
    if (!/^\d{4}$/.test(cleanCode)) {
      throw new Error('Private room code must contain exactly 4 numeric digits.');
    }

    const httpUrl = this.getHttpServerUrl();
    let resolveData: { status: string; roomId: string; roomCode: string };

    try {
      const response = await fetch(`${httpUrl}/api/match/resolve-private`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomCode: cleanCode,
          clientToken: this.clientToken,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || `Failed to resolve private room '${cleanCode}'.`);
      }
      resolveData = data;
    } catch (err: any) {
      throw new Error(err.message || `Unable to reach battle server for room '${cleanCode}'.`);
    }

    const options: JoinRoomOptions = {
      nickname,
      roomCode: cleanCode,
      isPrivate: true,
      clientToken: this.clientToken,
    };

    return this.connect(() => this.client.joinById(resolveData.roomId, options));
  }

  private async connect(connectFn: () => Promise<Room>): Promise<Room> {
    try {
      this.leave(); // Leave any previous room and clean state
      this.manualLeaveRequested = false;
      this.reconnectAttempts = 0;
      this.isReconnecting = false;
      this.cachedInitSpawn = undefined;

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
    const myEpoch = this.currentRoomEpoch;

    // Sync state
    room.onStateChange((state) => {
      if (this.currentRoomEpoch !== myEpoch || this.room !== room) return;
      this.onStateChange?.(state);
    });

    // Players collection change events
    const attachPlayerListeners = (state: any) => {
      if (this.currentRoomEpoch !== myEpoch || this.room !== room) return;
      if (state && state.players) {
        state.players.onAdd((player: any, key: string) => {
          if (this.currentRoomEpoch !== myEpoch || this.room !== room) return;
          this.onPlayerAdd?.(player, key);
        });
        state.players.onRemove((player: any, key: string) => {
          if (this.currentRoomEpoch !== myEpoch || this.room !== room) return;
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
      if (this.currentRoomEpoch !== myEpoch || this.room !== room) return;
      this.onHitConfirm?.(data);
    });

    room.onMessage('damage_received', (data: DamageReceivedPayload) => {
      if (this.currentRoomEpoch !== myEpoch || this.room !== room) return;
      this.onDamageReceived?.(data);
    });

    room.onMessage('kill_feed', (data: KillFeedItem) => {
      if (this.currentRoomEpoch !== myEpoch || this.room !== room) return;
      this.onKillFeed?.(data);
    });

    room.onMessage('weapon_tracer', (data: WeaponTracerEvent) => {
      if (this.currentRoomEpoch !== myEpoch || this.room !== room) return;
      this.onWeaponTracer?.(data);
    });

    room.onMessage('init_spawn', (data: SpawnConfirmedPayload) => {
      if (this.currentRoomEpoch !== myEpoch || this.room !== room) return;
      this.cachedInitSpawn = data;
      this.onInitSpawn?.(data);
    });

    room.onMessage('respawn_confirmed', (data: { x: number; y: number; z: number; yaw: number }) => {
      if (this.currentRoomEpoch !== myEpoch || this.room !== room) return;
      this.onRespawnConfirmed?.(data);
    });

    room.onMessage('match_over', (data: MatchWinnerPayload) => {
      if (this.currentRoomEpoch !== myEpoch || this.room !== room) return;
      this.onMatchOver?.(data);
    });

    room.onMessage('server_announcement', (data: { message: string }) => {
      if (this.currentRoomEpoch !== myEpoch || this.room !== room) return;
      this.onAnnouncement?.(data);
    });

    room.onLeave((code) => {
      if (this.currentRoomEpoch !== myEpoch) return;
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
          if (this.manualLeaveRequested || this.currentRoomEpoch !== myEpoch) return;
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
      if (this.currentRoomEpoch !== myEpoch) return;
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

  public sendToggleFireMode(mode?: 'SINGLE' | 'AUTO') {
    if (this.room && this.isConnected) {
      try {
        this.room.send('toggle_fire_mode', { mode });
      } catch (e) {
        console.warn('[ColyseusManager] Error sending toggle_fire_mode:', e);
      }
    }
  }

  public sendSwitchWeapon(weaponId: WeaponId) {
    if (this.room && this.isConnected) {
      try {
        this.room.send('switch_weapon', { weaponId });
      } catch (e) {
        console.warn('[ColyseusManager] Error sending switch_weapon:', e);
      }
    }
  }

  public leave() {
    this.currentRoomEpoch++;
    this.manualLeaveRequested = true;
    this.reconnectAttempts = this.maxReconnectAttempts;
    this.isReconnecting = false;
    if (this.room) {
      try {
        this.room.removeAllListeners();
        this.room.leave(true);
      } catch (e) {
        console.warn('[ColyseusManager] Error leaving room:', e);
      }
      this.room = null;
    }
    this.mySessionId = '';
    this.lastRoomId = '';
    this.reconnectionToken = '';
    this.isConnected = false;
    this.cachedInitSpawn = undefined;
  }
}
