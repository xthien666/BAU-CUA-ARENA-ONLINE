/** Short card loops use animated WebP, independent of browser video autoplay. */
export function createCardMotion(image) {
  if (!image) return { setVisible() {}, cleanup() {} };
  const poster = image.getAttribute('src');
  const motion = image.dataset.motionSrc;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const mobileScreen = window.matchMedia('(pointer: coarse), (max-width: 900px)');
  const forceMotion = image.dataset.forceMotion === 'true';
  let visible = false;
  let disposed = false;
  let failed = false;

  function sync() {
    if (disposed) return;
    const animate = visible && !document.hidden && !failed && (forceMotion || !reducedMotion.matches);
    const activeMotion = mobileScreen.matches && image.dataset.mobileMotionSrc ? image.dataset.mobileMotionSrc : motion;
    const source = animate && activeMotion ? activeMotion : poster;
    if (source && image.getAttribute('src') !== source) image.src = source;
  }

  function onError() {
    if (image.getAttribute('src') === poster) return;
    failed = true;
    sync();
  }

  function retry() { failed = false; sync(); }
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pageshow', sync);
  window.addEventListener('online', retry);
  reducedMotion.addEventListener('change', sync);
  mobileScreen.addEventListener('change', sync);
  image.addEventListener('error', onError);
  return {
    setVisible(value) { visible = value; if (value) failed = false; sync(); },
    cleanup() {
      visible = false;
      sync();
      disposed = true;
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('pageshow', sync);
      window.removeEventListener('online', retry);
      reducedMotion.removeEventListener('change', sync);
      mobileScreen.removeEventListener('change', sync);
      image.removeEventListener('error', onError);
    },
  };
}
