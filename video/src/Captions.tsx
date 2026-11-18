import React, { useMemo } from 'react';
import { spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { Theme, Word } from './types';

// Groups words into short lines (break at punctuation) and highlights the word being spoken.
function toChunks(words: Word[], max: number): Word[][] {
  const out: Word[][] = [];
  let cur: Word[] = [];
  for (const w of words) {
    cur.push(w);
    if (cur.length >= max || /[.,!?;:؟۔،]$/.test(w.text)) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

export const Captions: React.FC<{ words: Word[]; theme: Theme; ur: boolean }> = ({ words, theme, ur }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const portrait = height > width;
  const chunks = useMemo(() => toChunks(words, portrait ? 4 : 7), [words, portrait]);
  const t = frame / fps;

  let idx = -1;
  for (let i = 0; i < chunks.length; i++) if (chunks[i][0].start <= t) idx = i;
  if (idx < 0) return null;
  const chunk = chunks[idx];
  if (t > chunk[chunk.length - 1].end + 0.6) return null; // hide during pauses

  const startFrame = Math.round(chunk[0].start * fps);
  const pop = spring({ frame: frame - startFrame, fps, config: { damping: 15, mass: 0.5 } });

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: portrait ? 380 : 70,
        display: 'flex',
        justifyContent: 'center',
        padding: '0 60px',
      }}
    >
      <div
        style={{
          direction: ur ? 'rtl' : 'ltr',
          background: 'rgba(0,0,0,0.55)',
          borderRadius: 22,
          padding: ur ? '6px 34px 18px' : '14px 34px',
          fontSize: portrait ? 62 : 50,
          fontWeight: 700,
          lineHeight: ur ? 2.0 : 1.3,
          textAlign: 'center',
          maxWidth: portrait ? 940 : 1500,
          transform: `scale(${0.9 + 0.1 * pop})`,
          opacity: pop,
        }}
      >
        {chunk.map((w, i) => {
          const active = t >= w.start && t <= w.end + 0.05;
          const spoken = t > w.end;
          return (
            <span
              key={i}
              style={{
                color: active ? theme.accent : theme.text,
                opacity: active || spoken ? 1 : 0.75,
                margin: '0 0.14em',
                display: 'inline-block',
              }}
            >
              {w.text}
            </span>
          );
        })}
      </div>
    </div>
  );
};
