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
      const room = await connectFn();
      this.room = room;
      this.mySessionId = room.sessionId;
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
      this.isConnected = false;
      this.room = null;
      this.onDisconnect?.();
      console.log(`Disconnected from room with code: ${code}`);
    });

    room.onError((code, message) => {
      this.onError?.(`Server Error [${code}]: ${message}`);
    });
  }

  // --- CLIENT ACTIONS ---

  public sendMove(payload: PlayerInputPayload) {
    if (this.room && this.isConnected) {
      this.room.send('move', payload);
    }
  }

  public sendFire(payload: FireWeaponPayload) {
    if (this.room && this.isConnected) {
      this.room.send('fire', payload);
    }
  }

  public sendReload() {
    if (this.room && this.isConnected) {
      this.room.send('reload');
    }
  }

  public sendRespawnRequest() {
    if (this.room && this.isConnected) {
      this.room.send('respawn_request');
    }
  }

  public leave() {
    if (this.room) {
      try {
        this.room.leave();
      } catch {}
      this.room = null;
    }
    this.isConnected = false;
  }
}
