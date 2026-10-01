import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('mobile friends video stays small and places playback metadata before media data', async () => {
  const bytes = await readFile(new URL('../../public/assets/hub/baucua-mobile-v5.mp4', import.meta.url));
  assert(bytes.length < 600_000, 'mobile video must stay below 600 KB');
  const atoms = [];
  for (let offset = 0; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    assert(size >= 8 && offset + size <= bytes.length, 'valid top-level MP4 atom');
    atoms.push(bytes.toString('ascii', offset + 4, offset + 8));
    offset += size;
  }
  assert(atoms.includes('moov') && atoms.includes('mdat'));
  assert(atoms.indexOf('moov') < atoms.indexOf('mdat'), 'fast-start metadata comes first');
});

test('all five lobby WebP loops contain real frames and repeat forever', async () => {
  const names = ['quick-play-dragon-motion-v3', 'quick-play-dragon-motion-mobile-v3',
    'baucua-motion-v5', 'baucua-motion-mobile-v5', 'choose-table-lion-motion-v3'];
  for (const name of names) {
    const bytes = await readFile(new URL(`../../public/assets/hub/${name}.webp`, import.meta.url));
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
    let frames = 0;
    let duration = 0;
    let loop = null;
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const tag = bytes.toString('ascii', offset, offset + 4);
      const size = bytes.readUInt32LE(offset + 4);
      const payload = offset + 8;
      if (tag === 'ANIM') loop = bytes.readUInt16LE(payload + 4);
      if (tag === 'ANMF') {
        frames++;
        duration += bytes.readUIntLE(payload + 12, 3);
      }
      offset = payload + size + (size % 2);
    }
    assert(frames >= 20, `${name} must be animated, not a still poster`);
    assert(duration >= 1900 && duration < 5500, `${name} loop duration`);
    assert.equal(loop, 0, `${name} loops forever`);
  }
});
