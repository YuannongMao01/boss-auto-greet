// Human-like timing helpers: random delay, jitter, sleep. Avoids a mechanical action rhythm.
window.BAG = window.BAG || {};
(function () {
  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  // Apply +/- ratio jitter around a base duration in ms
  function jitter(baseMs, ratio) {
    ratio = ratio == null ? 0.3 : ratio;
    const delta = baseMs * ratio;
    return Math.round(baseMs - delta + Math.random() * 2 * delta);
  }
  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }
  window.BAG.humanize = { randInt: randInt, jitter: jitter, sleep: sleep };
})();
