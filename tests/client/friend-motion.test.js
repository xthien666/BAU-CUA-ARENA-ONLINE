import test from 'node:test';
import assert from 'node:assert/strict';
import { createFriendMotion } from '../../src/features/hub/friend-motion.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function setup(t, { mobile = true, supported = true } = {}) {
  const keys = ['window', 'document', 'setInterval', 'clearInterval'];
  const previous = Object.fromEntries(keys.map(key => [key, globalThis[key]]));
  const originalNow = Date.now;
  let now = 0;
  let monitor;
  Date.now = () => now;
  globalThis.setInterval = callback => { monitor = callback; return 1; };
  globalThis.clearInterval = () => { monitor = null; };
  const phone = Object.assign(new EventTarget(), { matches: mobile });
  const preference = Object.assign(new EventTarget(), { matches: true });
  const win = Object.assign(new EventTarget(), { matchMedia: query => query.includes('reduced-motion') ? preference : phone });
  const doc = Object.assign(new EventTarget(), { hidden: false });
  globalThis.window = win;
  globalThis.document = doc;
  const image = Object.assign(new EventTarget(), {
    src: '/poster.webp', dataset: { motionSrc: '/desktop.webp', mobileMotionSrc: '/fallback.webp', forceMotion: 'true' },
    getAttribute(name) { return this[name]; },
  });
  const video = Object.assign(new EventTarget(), {
    dataset: { src: '/phone.mp4' }, paused: true, hidden: true, currentTime: 0, plays: 0,
    canPlayType: () => supported ? 'probably' : '',
    getAttribute(name) { return this[name] || null; },
    play() {
      this.plays++;
      assert.equal(this.hidden, false);
      assert.equal(this.muted, true);
      assert.equal(this.defaultMuted, true);
      assert.equal(this.playsInline, true);
      if (this.playError) return Promise.reject(this.playError);
      this.paused = false;
      return Promise.resolve();
    },
    pause() { this.paused = true; },
  });
  const motion = createFriendMotion(image, video);
  t.after(() => {
    motion.cleanup();
    Date.now = originalNow;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
  return { image, video, motion, doc, phone, tick(ms) { now += ms; monitor?.(); } };
}

test('phone starts only one silent video without downloading the animated WebP', async t => {
  const { image, video, motion } = setup(t);
  motion.setVisible(true);
  await flush();
  assert.equal(image.src, '/poster.webp');
  assert.equal(video.src, '/phone.mp4');
  assert.equal(video.paused, false);
  assert.equal(video.loop, true);
});

test('desktop keeps its sharp WebP and does not load the mobile MP4', t => {
  const { image, video, motion } = setup(t, { mobile: false });
  motion.setVisible(true);
  assert.equal(image.src, '/desktop.webp');
  assert.equal(video.src, undefined);
  assert.equal(video.hidden, true);
});

test('denied autoplay falls back to animation, then retries on touch', async t => {
  const { image, video, motion, doc } = setup(t);
  video.playError = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
  motion.setVisible(true);
  await flush();
  assert.equal(image.src, '/fallback.webp');
  assert.equal(video.hidden, true);
  video.playError = null;
  doc.dispatchEvent(new Event('pointerdown'));
  await flush();
  assert.equal(video.paused, false);
  assert.equal(image.src, '/poster.webp');
});

test('unsupported H.264 uses only the small image loop', t => {
  const { image, video, motion } = setup(t, { supported: false });
  motion.setVisible(true);
  assert.equal(image.src, '/fallback.webp');
  assert.equal(video.src, undefined);
});

test('foregrounding resumes video without starting an image loop; cleanup stops motion', async t => {
  const { image, video, motion, doc } = setup(t);
  motion.setVisible(true);
  await flush();
  doc.hidden = true;
  doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(video.paused, true);
  assert.equal(image.src, '/poster.webp');
  doc.hidden = false;
  doc.dispatchEvent(new Event('visibilitychange'));
  await flush();
  assert.equal(video.paused, false);
  assert.equal(image.src, '/poster.webp');
  motion.cleanup();
  doc.dispatchEvent(new Event('pointerdown'));
  assert.equal(video.paused, true);
});

test('a frozen decoder is replaced by the fallback loop instead of covering the card', async t => {
  const { image, video, motion, tick } = setup(t);
  motion.setVisible(true);
  await flush();
  video.currentTime = 0.5;
  tick(4500);
  assert.equal(video.hidden, false);
  tick(7000);
  assert.equal(video.hidden, true);
  assert.equal(image.src, '/fallback.webp');
});
