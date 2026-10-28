import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ColyseusManager } from './network/ColyseusManager';
import { ArenaEngine } from './game/ArenaEngine';
import type { PlayerScoreEntry } from './game/ArenaEngine';
import { MainMenu } from './components/MainMenu';
import { FPSHUD } from './components/FPSHUD';
import { Scoreboard } from './components/Scoreboard';
import { DeathScreen } from './components/DeathScreen';
import { InGameMenu } from './components/InGameMenu';
import { MatchOverModal } from './components/MatchOverModal';
import type { KillFeedItem, MatchWinnerPayload } from '../shared/types';
import './App.css';

export const App: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ArenaEngine | null>(null);
  const colyseusRef = useRef<ColyseusManager>(new ColyseusManager());

  // Connection metadata stored in state to avoid reading refs in render
  const [serverUrl, setServerUrl] = useState<string>('');
  const [mySessionId, setMySessionId] = useState<string>('');

  useEffect(() => {
    setServerUrl(colyseusRef.current.getServerUrl());
  }, []);

  // App & Connection state
  const [appMode, setAppMode] = useState<'MENU' | 'PLAYING'>('MENU');
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | undefined>(undefined);

  // Gameplay state
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [isDead, setIsDead] = useState<boolean>(false);
  const [killerName, setKillerName] = useState<string>('Opponent');
  const [isPointerLocked, setIsPointerLocked] = useState<boolean>(false);
  const [matchWinner, setMatchWinner] = useState<MatchWinnerPayload | null>(null);
  const [isScoreboardOpen, setIsScoreboardOpen] = useState<boolean>(false);

  // HUD stats
  const [health, setHealth] = useState<number>(100);
  const [maxHealth] = useState<number>(100);
  const [ammo, setAmmo] = useState<number>(24);
  const [maxAmmo] = useState<number>(24);
  const [isReloading, setIsReloading] = useState<boolean>(false);
  const [matchTime, setMatchTime] = useState<number>(600);
  const [killFeed, setKillFeed] = useState<KillFeedItem[]>([]);
  const [players, setPlayers] = useState<PlayerScoreEntry[]>([]);

  // Feedback animations
  const [showHitmarker, setShowHitmarker] = useState<boolean>(false);
  const [isHeadshotHit, setIsHeadshotHit] = useState<boolean>(false);
  const [showDamageVignette, setShowDamageVignette] = useState<boolean>(false);

  // Preferences
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [sensitivity, setSensitivity] = useState<number>(0.0022);
  const [invertY, setInvertY] = useState<boolean>(false);

  const handleLeaveMatch = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.dispose();
      engineRef.current = null;
    }
    colyseusRef.current.leave();
    setMySessionId('');
    setAppMode('MENU');
    setIsPaused(false);
    setIsDead(false);
    setMatchWinner(null);
    setIsScoreboardOpen(false);
  }, []);

  // Setup connection error callback
  useEffect(() => {
    colyseusRef.current.onError = (err) => {
      setConnectionError(err);
      setIsConnecting(false);
    };

    colyseusRef.current.onDisconnect = () => {
      if (appMode === 'PLAYING') {
        handleLeaveMatch();
        setConnectionError('Connection to battle server was lost.');
      }
    };
  }, [appMode, handleLeaveMatch]);

  // Keyboard TAB listener for live Scoreboard & ESC listener for In-Game Menu
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        if (appMode === 'PLAYING') {
          setIsScoreboardOpen(true);
        }
      }

      if (e.code === 'Escape' && appMode === 'PLAYING') {
        if (!isDead && !matchWinner) {
          setIsPaused((prev) => !prev);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        setIsScoreboardOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [appMode, isDead, matchWinner]);

  // Start 3D Engine after room joined
  const initEngine = useCallback(() => {
    if (!containerRef.current) return;

    // Dispose old engine if any
    if (engineRef.current) {
      engineRef.current.dispose();
      engineRef.current = null;
    }

    const colyseus = colyseusRef.current;
    const engine = new ArenaEngine(containerRef.current, colyseus, {
      onAmmoChange: (currAmmo, maxA) => {
        setAmmo(currAmmo);
        setIsReloading(currAmmo === maxA ? false : engineRef.current?.isReloading ?? false);
      },
      onHealthChange: (currHp) => {
        setHealth(currHp);
      },
      onCrosshairHit: (headshot) => {
        setIsHeadshotHit(headshot);
        setShowHitmarker(true);
        setTimeout(() => setShowHitmarker(false), 120);
      },
      onDamageReceived: () => {
        setShowDamageVignette(true);
        setTimeout(() => setShowDamageVignette(false), 240);
      },
      onKillFeed: (item) => {
        setKillFeed((prev) => [...prev.slice(-9), item]);
      },
      onScoreboardUpdate: (entries) => {
        setPlayers(entries);
      },
      onPlayerDeath: (killer) => {
        setIsDead(true);
        setKillerName(killer);
      },
      onPlayerRespawn: () => {
        setIsDead(false);
        engineRef.current?.fpsController.requestPointerLock();
      },
      onPointerLockChange: (locked) => {
        setIsPointerLocked(locked);
      },
      onMatchOver: (winner) => {
        setMatchWinner(winner);
        engineRef.current?.fpsController.exitPointerLock();
      },
      onMatchTimeUpdate: (sec) => {
        setMatchTime(sec);
      },
    });

    engine.fpsController.sensitivity = sensitivity;
    engine.fpsController.invertY = invertY;
    engine.fpsAudio.setMasterVolume(soundEnabled ? 1.0 : 0.0);

    engineRef.current = engine;
    setMySessionId(colyseus.mySessionId);

    // Read room code from server state if present
    if (colyseus.room && colyseus.room.state) {
      const stateRoomCode = colyseus.room.state.roomCode;
      if (stateRoomCode) {
        setRoomCode(stateRoomCode);
      }
    }

    setAppMode('PLAYING');
    setIsConnecting(false);
    setIsPaused(false);
    setIsDead(false);
    setMatchWinner(null);

    // Initial lock request
    setTimeout(() => {
      engine.fpsController.requestPointerLock();
    }, 100);
  }, [sensitivity, invertY, soundEnabled]);

  // Matchmaking Handlers
  const handleJoinPublic = async (nickname: string) => {
    setIsConnecting(true);
    setConnectionError(null);
    try {
      const room = await colyseusRef.current.joinPublic(nickname);
      setRoomCode(room.state?.roomCode || undefined);
      initEngine();
    } catch (err: any) {
      setIsConnecting(false);
      setConnectionError(err.message || 'Failed to connect to public arena.');
    }
  };

  const handleCreatePrivate = async (nickname: string) => {
    setIsConnecting(true);
    setConnectionError(null);
    try {
      const room = await colyseusRef.current.createPrivate(nickname);
      setRoomCode(room.state?.roomCode || undefined);
      initEngine();
    } catch (err: any) {
      setIsConnecting(false);
      setConnectionError(err.message || 'Failed to create private match.');
    }
  };

  const handleJoinPrivate = async (nickname: string, code: string) => {
    setIsConnecting(true);
    setConnectionError(null);
    try {
      const room = await colyseusRef.current.joinPrivate(nickname, code);
      setRoomCode(room.state?.roomCode || code);
      initEngine();
    } catch (err: any) {
      setIsConnecting(false);
      setConnectionError(err.message || `Failed to join room '${code}'.`);
    }
  };

  const handleRespawn = () => {
    if (engineRef.current) {
      engineRef.current.requestRespawn();
    }
  };

  const handleResume = () => {
    setIsPaused(false);
    if (engineRef.current) {
      engineRef.current.fpsController.requestPointerLock();
    }
  };

  const handleSensitivityChange = (val: number) => {
    setSensitivity(val);
    if (engineRef.current) {
      engineRef.current.fpsController.sensitivity = val;
    }
  };

  const handleInvertYChange = (val: boolean) => {
    setInvertY(val);
    if (engineRef.current) {
      engineRef.current.fpsController.invertY = val;
    }
  };

  const handleToggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    if (engineRef.current) {
      engineRef.current.fpsAudio.setMasterVolume(next ? 1.0 : 0.0);
    }
  };

  const handleRequestPointerLock = () => {
    if (engineRef.current && !isPaused && !isDead && !matchWinner) {
      engineRef.current.fpsController.requestPointerLock();
    }
  };

  return (
    <div className="arena-app-container">
      {/* 3D WebGL Canvas Viewport */}
      <div
        ref={containerRef}
        id="arena-viewport"
        className="canvas-container"
        onClick={handleRequestPointerLock}
      />

      {/* Main Menu State */}
      {appMode === 'MENU' && (
        <MainMenu
          onJoinPublic={handleJoinPublic}
          onCreatePrivate={handleCreatePrivate}
          onJoinPrivate={handleJoinPrivate}
          serverUrl={serverUrl}
          isConnecting={isConnecting}
          connectionError={connectionError}
          onClearError={() => setConnectionError(null)}
          soundEnabled={soundEnabled}
          onToggleSound={handleToggleSound}
        />
      )}

      {/* In-Game Active HUD */}
      {appMode === 'PLAYING' && !isPaused && !matchWinner && (
        <FPSHUD
          health={health}
          maxHealth={maxHealth}
          ammo={ammo}
          maxAmmo={maxAmmo}
          isReloading={isReloading}
          matchTimeSeconds={matchTime}
          roomCode={roomCode}
          killFeed={killFeed}
          showHitmarker={showHitmarker}
          isHeadshotHit={isHeadshotHit}
          showDamageVignette={showDamageVignette}
          isPointerLocked={isPointerLocked}
          onRequestPointerLock={handleRequestPointerLock}
        />
      )}

      {/* Tab Overlay Scoreboard */}
      {appMode === 'PLAYING' && (
        <Scoreboard
          players={players}
          roomCode={roomCode}
          isOpen={isScoreboardOpen}
        />
      )}

      {/* Death Screen Overlay */}
      {appMode === 'PLAYING' && isDead && !matchWinner && (
        <DeathScreen
          killerName={killerName}
          onRespawn={handleRespawn}
        />
      )}

      {/* In-Game Pause & Settings Menu */}
      {appMode === 'PLAYING' && isPaused && (
        <InGameMenu
          roomCode={roomCode}
          sensitivity={sensitivity}
          onSensitivityChange={handleSensitivityChange}
          invertY={invertY}
          onInvertYChange={handleInvertYChange}
          soundEnabled={soundEnabled}
          onToggleSound={handleToggleSound}
          onResume={handleResume}
          onLeave={handleLeaveMatch}
        />
      )}

      {/* Match Over Modal */}
      {matchWinner && (
        <MatchOverModal
          winner={matchWinner}
          players={players}
          mySessionId={mySessionId}
          onReturnToLobby={handleLeaveMatch}
        />
      )}
    </div>
  );
};

export default App;
