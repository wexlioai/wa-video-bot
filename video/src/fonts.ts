import { loadFont as loadPoppins } from '@remotion/google-fonts/Poppins';
import { loadFont as loadNastaliq } from '@remotion/google-fonts/NotoNastaliqUrdu';

// Fonts are fetched from Google Fonts at render time (the server has internet).
export const latinFont = loadPoppins('normal', { weights: ['400', '600', '800'], subsets: ['latin'] }).fontFamily;
export const urduFont = loadNastaliq().fontFamily;
