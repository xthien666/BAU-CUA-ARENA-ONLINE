import { createCardMotion } from './card-motion.js';

/** One small native video on phones; an image loop if video cannot play. */
export function createFriendMotion(image, video) {
  const imageMotion = createCardMotion(image);
  if (!video) return imageMotion;
  const phone = window.matchMedia('(pointer: coarse), (max-width: 900px)');
  const supported = Boolean(video.canPlayType('video/mp4; codecs="avc1.42E01E"'));
  let visible = false;
  let disposed = false;
  let failed = false;
  let pending = null;
  let monitor = null;
  let lastTime = 0;
  let lastProgress = 0;
  const wantsVideo = () => !disposed && visible && !document.hidden && phone.matches && supported && !failed;

  function stopMonitor() { clearInterval(monitor); monitor = null; }
  function useFallback() {
    if (disposed) return;
    failed = true;
    sync();
  }
  function monitorProgress() {
    if (!wantsVideo()) return stopMonitor();
    if (video.currentTime !== lastTime) {
      lastTime = video.currentTime;
      lastProgress = Date.now();
    } else if (Date.now() - lastProgress > 6000) {
      // Never leave a frozen video covering the card indefinitely.
      useFallback();
    }
  }
  function sync() {
    if (disposed) return;
    const native = wantsVideo();
    // Foregrounding must not briefly download the WebP before video resumes.
    imageMotion.setVisible(visible && (!phone.matches || !supported || failed));
    video.hidden = !native;
    video.autoplay = native;
    if (!native) {
      stopMonitor();
      video.pause();
      return;
    }
    // Make it visible and silent BEFORE attaching src or requesting playback.
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.loop = true;
    if (!video.getAttribute('src')) {
      video.preload = 'auto';
      video.src = video.dataset.src;
    }
    if (!monitor) {
      lastTime = video.currentTime;
      lastProgress = Date.now();
      monitor = setInterval(monitorProgress, 1500);
    }
    if (pending || !video.paused) return;
    const attempt = video.play();
    pending = attempt;
    let interrupted = false;
    attempt?.then(() => { if (!wantsVideo()) video.pause(); }).catch(error => {
      interrupted = error?.name === 'AbortError';
      if (!interrupted && wantsVideo()) useFallback();
    }).finally(() => {
      if (pending === attempt) {
        pending = null;
        if (interrupted && wantsVideo()) sync();
      }
    });
  }
  function retry() { failed = false; sync(); }
  document.addEventListener('visibilitychange', sync);
  document.addEventListener('pointerdown', retry, { passive: true });
  document.addEventListener('keydown', retry);
  phone.addEventListener('change', sync);
  window.addEventListener('pageshow', sync);
  window.addEventListener('online', retry);
  video.addEventListener('canplay', sync);
  video.addEventListener('error', useFallback);
  return {
    setVisible(value) { visible = value; sync(); },
    cleanup() {
      visible = false;
      sync();
      disposed = true;
      imageMotion.cleanup();
      document.removeEventListener('visibilitychange', sync);
      document.removeEventListener('pointerdown', retry);
      document.removeEventListener('keydown', retry);
      phone.removeEventListener('change', sync);
      window.removeEventListener('pageshow', sync);
      window.removeEventListener('online', retry);
      video.removeEventListener('canplay', sync);
      video.removeEventListener('error', useFallback);
    },
  };
}
