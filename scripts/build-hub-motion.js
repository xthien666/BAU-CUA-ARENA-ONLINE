import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const bundled = resolve(root, '.tools/ffmpeg/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe');
const ffmpeg = process.env.FFMPEG_PATH || (existsSync(bundled) ? bundled : 'ffmpeg');
const assets = resolve(root, 'public/assets/hub');
const sources = resolve(root, process.env.HUB_MOTION_SOURCE_DIR || 'media-sources/hub');
const clips = [
  ['quick-play-dragon-loop.mp4', 'quick-play-dragon', 2.5, 576, 84],
  ['baucua.mp4', 'baucua', 1.5, 640, 84],
  ['choose-table-lion.mp4', 'choose-table-lion', 1, 480, 75],
];

for (const [source] of clips) {
  if (!existsSync(resolve(sources, source))) {
    throw new Error(`Missing source ${source}. Place original videos in media-sources/hub or set HUB_MOTION_SOURCE_DIR. Normal npm builds use the committed motion assets and do not need these sources.`);
  }
}
if (process.argv.includes('--check-sources')) {
  console.log('All three original hub video sources are available.');
  process.exit(0);
}

function run(args) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`FFmpeg exited with ${result.status}`);
}

const selectedClips = process.argv.includes('--friend-only') ? clips.filter(([, name]) => name === 'baucua') : clips;
for (const [source, name, speed, width, quality] of selectedClips) {
  if (name === 'baucua') {
    run(['-i', resolve(sources, source), '-an', '-vf', `setpts=PTS/${speed},scale=384:-2:flags=lanczos,fps=24,setsar=1`,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-profile:v', 'baseline',
      '-level:v', '3.0', '-pix_fmt', 'yuv420p', '-maxrate', '650k', '-bufsize', '1300k',
      '-g', '24', '-bf', '0', '-movflags', '+faststart', resolve(assets, 'baucua-mobile-v5.mp4')]);
    run(['-i', resolve(sources, source), '-an', '-vf', `setpts=PTS/${speed},scale=320:-2:flags=lanczos,fps=24,setsar=1`,
      '-c:v', 'libwebp_anim', '-lossless', '0', '-compression_level', '6',
      '-quality', '68', '-loop', '0', resolve(assets, 'baucua-motion-mobile-v5.webp')]);
  }
  // Native animated images do not depend on media autoplay or video decoders.
  const filter = `setpts=PTS/${speed},scale=${width}:-2:flags=lanczos,fps=12,setsar=1`;
  run(['-i', resolve(sources, source), '-an', '-vf', filter,
    '-c:v', 'libwebp_anim', '-lossless', '0', '-compression_level', '6',
    '-quality', String(quality), '-loop', '0', resolve(assets, `${name}-motion-${name === 'baucua' ? 'v5' : 'v3'}.webp`)]);
  if (width > 480 && name !== 'baucua') {
    run(['-i', resolve(sources, source), '-an',
      '-vf', `setpts=PTS/${speed},scale=480:-2:flags=lanczos,fps=12,setsar=1`,
      '-c:v', 'libwebp_anim', '-lossless', '0', '-compression_level', '6',
      '-quality', String(quality), '-loop', '0', resolve(assets, `${name}-motion-mobile-v3.webp`)]);
  }
  run(['-ss', '0.15', '-i', resolve(sources, source), '-frames:v', '1',
    '-vf', `scale=${width}:-2:flags=lanczos,setsar=1`, '-c:v', 'libwebp',
    '-quality', String(quality), resolve(assets, `${name}-poster-v3.webp`)]);
  console.log(`Built ${name} motion and poster`);
}
