export type Word = { text: string; start: number; end: number }; // seconds, relative to scene start

export type Visual =
  | { type: 'title'; heading: string; subheading?: string }
  | { type: 'statement'; text: string; highlight?: string }
  | { type: 'bullets'; heading?: string; items: string[] }
  | { type: 'bignumber'; value: string; label: string }
  | { type: 'quote'; text: string; author?: string }
  | { type: 'compare'; left: { title: string; items: string[] }; right: { title: string; items: string[] } }
  | { type: 'bars'; heading?: string; bars: { label: string; value: number }[]; unit?: string };

export type Theme = { bg: string; bg2: string; primary: string; accent: string; text: string };

export type Scene = { id: string; audio: string; durationInFrames: number; words: Word[]; visual: Visual };

export type VideoProps = {
  fps: number;
  language: 'ur' | 'en';
  theme: Theme;
  captions: boolean;
  scenes: Scene[];
};
