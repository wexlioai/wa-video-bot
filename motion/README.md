# motion/

The new motion engine ([HyperFrames](https://github.com/heygen-com/hyperframes)): every scene is HTML + CSS + GSAP, rendered to MP4 with headless Chrome and FFmpeg.

The bot installs this folder's packages by itself (after an update, or at start when `node_modules` is missing).
Send `engine test` on WhatsApp to render a 15-second test and see how fast this machine renders.

Manual check: `cd motion && npx hyperframes doctor`
