import React from 'react';
import { AbsoluteFill, random, useCurrentFrame, useVideoConfig } from 'remotion';
import { Theme } from './types';

// Slow, deterministic motion: soft glowing blobs, a rotating ring and a dot grid.
export const Background: React.FC<{ theme: Theme }> = ({ theme }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = frame / 30;
  const blobs = new Array(6).fill(0).map((_, i) => {
    const r = (k: string) => random(`${i}-${k}`);
    const size = (0.25 + r('s') * 0.35) * Math.max(width, height);
    const x = r('x') * width + Math.sin(t * (0.15 + r('vx') * 0.2) + i) * width * 0.08;
    const y = r('y') * height + Math.cos(t * (0.12 + r('vy') * 0.2) + i) * height * 0.08;
    const color = i % 3 === 0 ? theme.primary : i % 3 === 1 ? theme.accent : theme.bg2;
    return { size, x, y, color, op: i % 3 === 1 ? 0.12 : 0.22 };
  });
  const ring = Math.min(width, height) * 0.9;
  return (
    <AbsoluteFill style={{ overflow: 'hidden', direction: 'ltr' }}>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at 30% 20%, ${theme.bg2} 0%, ${theme.bg} 65%)` }} />
      {blobs.map((b, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: b.x - b.size / 2,
            top: b.y - b.size / 2,
            width: b.size,
            height: b.size,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${b.color} 0%, transparent 70%)`,
            opacity: b.op,
          }}
        />
      ))}
      <div
        style={{
          position: 'absolute',
          left: width * 0.78 - ring / 2,
          top: height * 0.72 - ring / 2,
          width: ring,
          height: ring,
          borderRadius: '50%',
          border: `2px dashed ${theme.primary}`,
          opacity: 0.18,
          transform: `rotate(${t * 6}deg)`,
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.10) 1.5px, transparent 1.5px)',
          backgroundSize: '44px 44px',
          backgroundPosition: `${(t * 6) % 44}px ${(t * 3) % 44}px`,
          opacity: 0.5,
        }}
      />
    </AbsoluteFill>
  );
};
