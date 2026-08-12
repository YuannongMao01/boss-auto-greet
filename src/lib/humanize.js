// 拟人化工具：随机延迟、抖动、sleep。降低机械化行为特征。
window.BAG = window.BAG || {};
(function () {
  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  // 在基准毫秒上做 ±ratio 抖动
  function jitter(baseMs, ratio) {
    ratio = ratio == null ? 0.3 : ratio;
    const delta = baseMs * ratio;
    return Math.round(baseMs - delta + Math.random() * 2 * delta);
  }
  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }
  // 秒区间 -> 随机毫秒
  function delayMs(minSec, maxSec) {
    return randInt(minSec * 1000, maxSec * 1000);
  }
  window.BAG.humanize = { randInt: randInt, jitter: jitter, sleep: sleep, delayMs: delayMs };
})();
