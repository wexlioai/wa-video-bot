import React from 'react';
import { AbsoluteFill, Audio, Series, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { VideoProps, Scene, Theme } from './types';
import { Background } from './Background';
import { Captions } from './Captions';
import { SceneVisual } from './scenes';
import { latinFont, urduFont } from './fonts';

export const Video: React.FC<VideoProps> = (p) => {
  const ur = p.language === 'ur';
  return (
    <AbsoluteFill
      style={{
        backgroundColor: p.theme.bg,
        color: p.theme.text,
        fontFamily: ur ? `${urduFont}, ${latinFont}` : latinFont,
        direction: ur ? 'rtl' : 'ltr',
      }}
    >
      <Background theme={p.theme} />
      <Series>
        {p.scenes.map((s, i) => (
          <Series.Sequence key={s.id} durationInFrames={s.durationInFrames} name={`${i + 1}. ${s.visual.type}`}>
            {s.audio ? <Audio src={staticFile(s.audio)} /> : null}
            <SceneFrame scene={s} theme={p.theme} ur={ur} />
            {p.captions ? <Captions words={s.words} theme={p.theme} ur={ur} /> : null}
          </Series.Sequence>
        ))}
      </Series>
      <ProgressBar color={p.theme.primary} />
    </AbsoluteFill>
  );
};

// Enter/exit transition around each scene + the safe area the visual lives in.
const SceneFrame: React.FC<{ scene: Scene; theme: Theme; ur: boolean }> = ({ scene, theme, ur }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const portrait = height > width;
  const d = scene.durationInFrames;
  const opacity = interpolate(frame, [0, 10, d - 10, d], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const y = interpolate(frame, [0, 14], [40, 0], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill
      style={{
        opacity,
        transform: `translateY(${y}px)`,
        // leave room at the bottom for captions
        padding: portrait ? '180px 80px 560px' : '90px 160px 230px',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <SceneVisual visual={scene.visual} theme={theme} ur={ur} portrait={portrait} duration={d} />
    </AbsoluteFill>
  );
};

const ProgressBar: React.FC<{ color: string }> = ({ color }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 8, background: 'rgba(255,255,255,0.08)' }}>
      <div style={{ width: `${(frame / durationInFrames) * 100}%`, height: '100%', background: color, marginInlineStart: 0 }} />
    </div>
  );
};
