import React from 'react';
import { CalculateMetadataFunction, Composition } from 'remotion';
import { Video } from './Video';
import { VideoProps } from './types';

// Preview data for `npm run studio` (no audio files needed).
const sample: VideoProps = {
  fps: 30,
  language: 'en',
  captions: true,
  theme: { bg: '#0b1020', bg2: '#1c2b52', primary: '#4f8cff', accent: '#ffd166', text: '#ffffff' },
  scenes: [
    { id: 's01', audio: '', durationInFrames: 120, words: demoWords('Welcome to this quick explainer about saving money'), visual: { type: 'title', heading: 'How to Save Money', subheading: 'Five simple habits' } },
    { id: 's02', audio: '', durationInFrames: 150, words: demoWords('Most people spend seventy percent of their income without noticing'), visual: { type: 'bignumber', value: '70%', label: 'of income spent without noticing' } },
    { id: 's03', audio: '', durationInFrames: 150, words: demoWords('Here are the habits that make the biggest difference'), visual: { type: 'bullets', heading: 'Key habits', items: ['Track every expense', 'Pay yourself first', 'Cook at home', 'Cancel unused subscriptions'] } },
    { id: 's04', audio: '', durationInFrames: 150, words: demoWords('Compare that with how small amounts grow over time'), visual: { type: 'bars', heading: 'Savings after 5 years', unit: 'k', bars: [{ label: 'Rs 1000/mo', value: 60 }, { label: 'Rs 3000/mo', value: 180 }, { label: 'Rs 5000/mo', value: 300 }] } },
  ],
};

function demoWords(s: string) {
  return s.split(' ').map((w, i) => ({ text: w, start: 0.3 + i * 0.35, end: 0.3 + i * 0.35 + 0.3 }));
}

const calc: CalculateMetadataFunction<VideoProps> = ({ props }) => ({
  fps: props.fps,
  durationInFrames: Math.max(1, props.scenes.reduce((a, s) => a + s.durationInFrames, 0)),
});

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="Long" component={Video} width={1920} height={1080} fps={30} durationInFrames={300} defaultProps={sample} calculateMetadata={calc} />
    <Composition id="Short" component={Video} width={1080} height={1920} fps={30} durationInFrames={300} defaultProps={sample} calculateMetadata={calc} />
  </>
);
