import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { Theme, Visual } from './types';

type P = { theme: Theme; ur: boolean; portrait: boolean; duration: number };

// shrink long text so it never overflows
const fit = (text: string, base: number, soft = 40) =>
  Math.round(base * Math.max(0.5, Math.min(1, 1 - (text.length - soft) / (soft * 4))));

function usePop(delay: number) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping: 14, mass: 0.6 } });
}

// Nastaliq sits tall; give it room so diacritics aren't clipped.
const lh = (ur: boolean) => (ur ? 1.9 : 1.2);

export const SceneVisual: React.FC<{ visual: Visual } & P> = ({ visual, ...p }) => {
  switch (visual.type) {
    case 'title': return <Title v={visual} {...p} />;
    case 'statement': return <Statement v={visual} {...p} />;
    case 'bullets': return <Bullets v={visual} {...p} />;
    case 'bignumber': return <BigNumber v={visual} {...p} />;
    case 'quote': return <Quote v={visual} {...p} />;
    case 'compare': return <Compare v={visual} {...p} />;
    case 'bars': return <Bars v={visual} {...p} />;
    default: return null;
  }
};

type V<T extends Visual['type']> = Extract<Visual, { type: T }>;

const Title: React.FC<{ v: V<'title'> } & P> = ({ v, theme, ur, portrait }) => {
  const a = usePop(2);
  const b = usePop(14);
  const line = usePop(8);
  return (
    <div style={{ textAlign: 'center' }}>
      <div
        style={{
          fontSize: fit(v.heading, portrait ? 110 : 120, 28),
          fontWeight: 800,
          lineHeight: lh(ur),
          transform: `scale(${0.85 + 0.15 * a})`,
          opacity: a,
          textShadow: '0 8px 40px rgba(0,0,0,0.45)',
        }}
      >
        {v.heading}
      </div>
      <div style={{ height: 10, width: `${line * (portrait ? 50 : 30)}%`, margin: '28px auto', borderRadius: 10, background: `linear-gradient(90deg, ${theme.primary}, ${theme.accent})` }} />
      {v.subheading ? (
        <div style={{ fontSize: fit(v.subheading, portrait ? 58 : 56, 40), opacity: b * 0.9, lineHeight: lh(ur), transform: `translateY(${(1 - b) * 30}px)` }}>
          {v.subheading}
        </div>
      ) : null}
    </div>
  );
};

const Statement: React.FC<{ v: V<'statement'> } & P> = ({ v, theme, ur, portrait }) => {
  const frame = useCurrentFrame();
  const words = v.text.split(/\s+/);
  const hl = new Set((v.highlight || '').split(/\s+/).filter(Boolean).map((w) => w.replace(/[.,!?؟۔،]/g, '')));
  const size = fit(v.text, portrait ? 96 : 100, 45);
  return (
    <div style={{ textAlign: 'center', fontSize: size, fontWeight: 800, lineHeight: lh(ur) }}>
      {words.map((w, i) => {
        const o = interpolate(frame, [4 + i * 3, 12 + i * 3], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        const isHl = hl.has(w.replace(/[.,!?؟۔،]/g, ''));
        return (
          <span key={i} style={{ display: 'inline-block', margin: '0 0.16em', opacity: o, transform: `translateY(${(1 - o) * 24}px)`, color: isHl ? theme.accent : theme.text }}>
            {w}
          </span>
        );
      })}
    </div>
  );
};

const Bullets: React.FC<{ v: V<'bullets'> } & P> = ({ v, theme, ur, portrait, duration }) => {
  const head = usePop(0);
  const gap = Math.max(8, Math.min(24, (duration * 0.55) / Math.max(1, v.items.length)));
  const longest = Math.max(...v.items.map((x) => x.length));
  const size = fit('x'.repeat(longest), portrait ? 60 : 56, 30);
  return (
    <div style={{ width: '100%', maxWidth: portrait ? 920 : 1400 }}>
      {v.heading ? (
        <div style={{ fontSize: fit(v.heading, portrait ? 80 : 76, 25), fontWeight: 800, marginBottom: 36, opacity: head, lineHeight: lh(ur), color: theme.accent }}>
          {v.heading}
        </div>
      ) : null}
      {v.items.map((item, i) => (
        <BulletRow key={i} text={item} delay={8 + i * gap} n={i + 1} theme={theme} ur={ur} size={size} />
      ))}
    </div>
  );
};

const BulletRow: React.FC<{ text: string; delay: number; n: number; theme: Theme; ur: boolean; size: number }> = ({ text, delay, n, theme, ur, size }) => {
  const s = usePop(delay);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 28, marginBottom: 26, opacity: s, transform: `translateX(${(ur ? -1 : 1) * (1 - s) * -60}px)` }}>
      <div style={{ flex: 'none', width: size * 1.3, height: size * 1.3, borderRadius: '50%', background: theme.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.65, fontWeight: 800, fontFamily: 'inherit', direction: 'ltr' }}>
        {n}
      </div>
      <div style={{ fontSize: size, fontWeight: 600, lineHeight: lh(ur) }}>{text}</div>
    </div>
  );
};

const BigNumber: React.FC<{ v: V<'bignumber'> } & P> = ({ v, theme, ur, portrait }) => {
  const frame = useCurrentFrame();
  const a = usePop(0);
  const lbl = usePop(16);
  const m = v.value.match(/^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/);
  let shown = v.value;
  if (m) {
    const raw = m[2];
    const num = parseFloat(raw.replace(/,/g, ''));
    const isYear = /^\d{4}$/.test(raw) && num > 1800 && num < 2200;
    if (!isYear && isFinite(num)) {
      const p = interpolate(frame, [0, 40], [0, 1], { extrapolateRight: 'clamp', easing: (x) => 1 - Math.pow(1 - x, 3) });
      const dec = (raw.split('.')[1] || '').length;
      const val = (num * p).toFixed(dec);
      shown = m[1] + (raw.includes(',') ? Number(val).toLocaleString('en-US', { minimumFractionDigits: dec }) : val) + m[3];
    }
  }
  const ring = portrait ? 640 : 560;
  return (
    <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ position: 'relative', width: ring, height: ring, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width={ring} height={ring} style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}>
          <circle cx={ring / 2} cy={ring / 2} r={ring / 2 - 14} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={14} />
          <circle cx={ring / 2} cy={ring / 2} r={ring / 2 - 14} fill="none" stroke={theme.accent} strokeWidth={14} strokeLinecap="round"
            strokeDasharray={Math.PI * (ring - 28)} strokeDashoffset={Math.PI * (ring - 28) * (1 - a * 0.75)} />
        </svg>
        <div style={{ fontSize: fit(shown, portrait ? 190 : 170, 5), fontWeight: 800, direction: 'ltr', fontFamily: 'inherit', transform: `scale(${0.7 + 0.3 * a})`, color: theme.text }}>
          {shown}
        </div>
      </div>
      <div style={{ marginTop: 30, fontSize: fit(v.label, portrait ? 64 : 58, 35), fontWeight: 600, opacity: lbl, lineHeight: lh(ur), maxWidth: portrait ? 900 : 1300 }}>
        {v.label}
      </div>
    </div>
  );
};

const Quote: React.FC<{ v: V<'quote'> } & P> = ({ v, theme, ur, portrait }) => {
  const a = usePop(0);
  const b = usePop(12);
  const c = usePop(26);
  return (
    <div style={{ textAlign: 'center', maxWidth: portrait ? 920 : 1450 }}>
      <div style={{ fontSize: 260, lineHeight: 0.8, color: theme.accent, opacity: a, transform: `scale(${a})`, fontFamily: 'Georgia, serif', direction: 'ltr' }}>“</div>
      <div style={{ fontSize: fit(v.text, portrait ? 74 : 72, 60), fontWeight: 600, fontStyle: ur ? 'normal' : 'italic', lineHeight: lh(ur), opacity: b, transform: `translateY(${(1 - b) * 30}px)` }}>
        {v.text}
      </div>
      {v.author ? <div style={{ marginTop: 34, fontSize: portrait ? 50 : 46, color: theme.accent, opacity: c }}>— {v.author}</div> : null}
    </div>
  );
};

const Compare: React.FC<{ v: V<'compare'> } & P> = ({ v, theme, ur, portrait }) => {
  const l = usePop(4);
  const r = usePop(16);
  const vs = usePop(10);
  const card = (side: { title: string; items: string[] }, s: number, color: string, dir: number) => (
    <div style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: `3px solid ${color}`, borderRadius: 32, padding: portrait ? '36px 44px' : '44px 52px', opacity: s, transform: portrait ? `translateY(${(1 - s) * 60 * dir}px)` : `translateX(${(1 - s) * 80 * dir}px)` }}>
      <div style={{ fontSize: fit(side.title, 64, 18), fontWeight: 800, color, marginBottom: 20, lineHeight: lh(ur) }}>{side.title}</div>
      {side.items.slice(0, 4).map((it, i) => (
        <div key={i} style={{ fontSize: fit(it, portrait ? 46 : 44, 26), lineHeight: lh(ur), marginBottom: 10, opacity: 0.92 }}>• {it}</div>
      ))}
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: portrait ? 'column' : 'row', gap: portrait ? 30 : 50, width: '100%', alignItems: 'stretch', position: 'relative' }}>
      {card(v.left, l, theme.primary, -1)}
      <div style={{ alignSelf: 'center', flex: 'none', width: 120, height: 120, borderRadius: '50%', background: theme.accent, color: theme.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 48, fontWeight: 800, transform: `scale(${vs})`, direction: 'ltr', fontFamily: 'sans-serif' }}>VS</div>
      {card(v.right, r, theme.accent, 1)}
    </div>
  );
};

const Bars: React.FC<{ v: V<'bars'> } & P> = ({ v, theme, ur, portrait }) => {
  const head = usePop(0);
  const max = Math.max(...v.bars.map((b) => b.value), 1);
  return (
    <div style={{ width: '100%', maxWidth: portrait ? 940 : 1450 }}>
      {v.heading ? <div style={{ fontSize: fit(v.heading, portrait ? 76 : 72, 25), fontWeight: 800, marginBottom: 40, opacity: head, lineHeight: lh(ur) }}>{v.heading}</div> : null}
      {v.bars.slice(0, 6).map((b, i) => (
        <BarRow key={i} label={b.label} value={b.value} unit={v.unit || ''} frac={b.value / max} delay={8 + i * 8} color={i % 2 ? theme.accent : theme.primary} ur={ur} portrait={portrait} />
      ))}
    </div>
  );
};

const BarRow: React.FC<{ label: string; value: number; unit: string; frac: number; delay: number; color: string; ur: boolean; portrait: boolean }> = ({ label, value, unit, frac, delay, color, ur, portrait }) => {
  const s = usePop(delay);
  return (
    <div style={{ marginBottom: portrait ? 34 : 26 }}>
      <div style={{ fontSize: portrait ? 44 : 40, fontWeight: 600, lineHeight: lh(ur), opacity: s }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <div style={{ height: portrait ? 56 : 50, width: `${Math.max(2, frac * 82 * s)}%`, borderRadius: 14, background: `linear-gradient(90deg, ${color}, ${color}cc)` }} />
        <div style={{ fontSize: portrait ? 44 : 40, fontWeight: 800, direction: 'ltr', opacity: s }}>
          {Number((value * s).toFixed(Number.isInteger(value) ? 0 : 1)).toLocaleString('en-US')}{unit}
        </div>
      </div>
    </div>
  );
};
