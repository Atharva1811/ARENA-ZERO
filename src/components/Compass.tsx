import React from 'react';
import * as THREE from 'three';
import type { CollectibleItem } from '../game/types';

interface CompassProps {
  playerPos: THREE.Vector3;
  playerRotY: number;
  collectibles: CollectibleItem[];
  shrinePos: THREE.Vector3;
  shrineUnlocked: boolean;
}

export const Compass: React.FC<CompassProps> = ({
  playerPos,
  playerRotY,
  collectibles,
  shrinePos,
  shrineUnlocked,
}) => {
  // Calculate relative angle to target
  const getAngleDiff = (targetPos: THREE.Vector3) => {
    const dx = targetPos.x - playerPos.x;
    const dz = targetPos.z - playerPos.z;
    const targetAngle = Math.atan2(dx, dz);
    let diff = targetAngle - playerRotY;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    return diff;
  };

  const getTargetDistance = (targetPos: THREE.Vector3) => {
    return Math.round(Math.hypot(targetPos.x - playerPos.x, targetPos.z - playerPos.z));
  };

  const uncollected = collectibles.filter((c) => !c.collected);

  return (
    <div className="compass-container">
      {/* Compass Bar strip */}
      <div className="compass-strip">
        {/* Shrine marker */}
        {(() => {
          const diff = getAngleDiff(shrinePos);
          const dist = getTargetDistance(shrinePos);
          // If within 90 degree field of view
          if (Math.abs(diff) < Math.PI / 2.2) {
            const percent = 50 + (diff / (Math.PI / 2.2)) * 45;
            return (
              <div
                className="compass-marker shrine-marker"
                style={{ left: `${percent}%` }}
                title={`Shrine (${dist}m)`}
              >
                <div className={`shrine-pip ${shrineUnlocked ? 'unlocked' : ''}`}>🏛️</div>
                <span className="marker-dist">{dist}m</span>
              </div>
            );
          }
          return null;
        })()}

        {/* Uncollected crystals */}
        {uncollected.map((crystal) => {
          const diff = getAngleDiff(crystal.position);
          const dist = getTargetDistance(crystal.position);
          if (Math.abs(diff) < Math.PI / 2.2) {
            const percent = 50 + (diff / (Math.PI / 2.2)) * 45;
            return (
              <div
                key={crystal.id}
                className="compass-marker crystal-marker"
                style={{ left: `${percent}%` }}
                title={`${crystal.name} (${dist}m)`}
              >
                <div
                  className="crystal-pip"
                  style={{
                    backgroundColor: crystal.color,
                    boxShadow: `0 0 10px ${crystal.color}`,
                  }}
                />
                <span className="marker-dist">{dist}m</span>
              </div>
            );
          }
          return null;
        })}

        {/* Center reticle */}
        <div className="compass-center-reticle" />
      </div>
    </div>
  );
};
