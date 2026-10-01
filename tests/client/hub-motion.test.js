import test from 'node:test';
import assert from 'node:assert/strict';
import { createCardMotion } from '../../src/features/hub/card-motion.js';

function setup(t, { reduced = false, force = true, mobile = false } = {}) {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const preference = Object.assign(new EventTarget(), { matches: reduced });
  const screen = Object.assign(new EventTarget(), { matches: mobile });
  const win = Object.assign(new EventTarget(), { matchMedia: query => query.includes('reduced-motion') ? preference : screen });
  const doc = Object.assign(new EventTarget(), { hidden: false });
  globalThis.window = win;
  globalThis.document = doc;
  const image = Object.assign(new EventTarget(), {
    src: '/poster.webp',
    dataset: { motionSrc: '/loop.webp', forceMotion: String(force) },
    getAttribute(name) { return this[name]; },
  });
  const motion = createCardMotion(image);
  t.after(() => {
    motion.cleanup();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });
  return { image, motion, doc, win, preference, screen };
}

test('visible card starts native image animation without a video or intersection callback', t => {
  const { image, motion } = setup(t);
  assert.equal(image.src, '/poster.webp');
  motion.setVisible(true);
  assert.equal(image.src, '/loop.webp');
  motion.setVisible(false);
  assert.equal(image.src, '/poster.webp');
});

test('card suspends in background and resumes when foregrounded', t => {
  const { image, motion, doc } = setup(t);
  motion.setVisible(true);
  doc.hidden = true;
  doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(image.src, '/poster.webp');
  doc.hidden = false;
  doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(image.src, '/loop.webp');
});

test('phone gets the sharper lightweight loop, desktop gets the larger derivative', t => {
  const { image, motion, screen } = setup(t, { mobile: true });
  image.dataset.mobileMotionSrc = '/phone-loop.webp';
  motion.setVisible(true);
  assert.equal(image.src, '/phone-loop.webp');
  screen.matches = false;
  screen.dispatchEvent(new Event('change'));
  assert.equal(image.src, '/loop.webp');
});

test('failed animation shows poster and retries when connectivity returns', t => {
  const { image, motion, win } = setup(t);
  motion.setVisible(true);
  image.dispatchEvent(new Event('error'));
  assert.equal(image.src, '/poster.webp');
  win.dispatchEvent(new Event('online'));
  assert.equal(image.src, '/loop.webp');
});

test('requested card motion plays with reduced motion, other decorations respect preference', t => {
  const { image, motion } = setup(t, { reduced: true, force: true });
  motion.setVisible(true);
  assert.equal(image.src, '/loop.webp');
});

test('unforced animation respects reduced motion and no longer resumes after cleanup', t => {
  const { image, motion, preference, win } = setup(t, { reduced: true, force: false });
  motion.setVisible(true);
  assert.equal(image.src, '/poster.webp');
  preference.matches = false;
  preference.dispatchEvent(new Event('change'));
  assert.equal(image.src, '/loop.webp');
  motion.cleanup();
  win.dispatchEvent(new Event('pageshow'));
  assert.equal(image.src, '/poster.webp');
});
