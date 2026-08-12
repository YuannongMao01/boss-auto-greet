// chrome.storage.local 封装：配置、已见 jobId、队列、运行状态、每日计数、日志。
window.BAG = window.BAG || {};
(function () {
  const DEFAULT_CONFIG = {
    searchQuery: "",       // 送去 Boss 搜索的词（一个）
    mustInclude: [],       // 结果里必须逐字出现的词（可多个，全部满足）
    excludeKeywords: [],   // 屏蔽词（命中任一则排除）
    cities: [],            // 城市（location 包含任一）
    minSalary: 0,          // 薪资下限（单位 K/千），0 = 不限
    todayOnly: false,      // 仅今日新发布（尽力匹配卡片上的时间标记）
    greeting: "",          // 自定义打招呼语；留空则用 Boss 账号默认招呼语
    dailyCap: 40,          // 每日打招呼上限
    intervalMin: 8,        // 打招呼间隔下限（秒）
    intervalMax: 30,       // 打招呼间隔上限（秒）
    workStart: "09:00",    // 工作时段开始
    workEnd: "20:00"       // 工作时段结束
  };

  function get(keys) { return new Promise(function (r) { chrome.storage.local.get(keys, r); }); }
  function set(obj) { return new Promise(function (r) { chrome.storage.local.set(obj, r); }); }

  async function getConfig() {
    const o = await get("config");
    const c = Object.assign({}, DEFAULT_CONFIG, o.config || {});
    // 迁移旧配置：keywords[0] -> searchQuery，其余 -> mustInclude
    if (!c.searchQuery && Array.isArray(c.keywords) && c.keywords.length) {
      c.searchQuery = c.keywords[0];
      if (!c.mustInclude || !c.mustInclude.length) c.mustInclude = c.keywords.slice(1);
    }
    return c;
  }
  async function setConfig(patch) {
    const cur = await getConfig();
    const next = Object.assign({}, cur, patch);
    await set({ config: next });
    return next;
  }
  function remove(keys) { return new Promise(function (r) { chrome.storage.local.remove(keys, r); }); }

  // “已招呼”集合：只由真正完成打招呼的动作写入，永久排除，无重置入口。
  // 旧版本曾把“所有扫过的卡片”都写进 seenJobs（污染），首次读取时从日志重建真实记录并丢弃脏数据。
  async function getGreeted() {
    const o = await get(["greetedJobs", "logs", "seenJobs"]);
    if (o.greetedJobs) return new Set(o.greetedJobs);
    const fromLogs = (o.logs || [])
      .filter(function (l) { return l.status === "greeted" && l.jobId; })
      .map(function (l) { return l.jobId; });
    const arr = Array.from(new Set(fromLogs));
    await set({ greetedJobs: arr });
    if (o.seenJobs) await remove("seenJobs");
    return new Set(arr);
  }
  async function addGreeted(ids) {
    const g = await getGreeted();
    ids.forEach(function (id) { g.add(id); });
    let arr = Array.from(g);
    if (arr.length > 5000) arr = arr.slice(arr.length - 5000); // 上限，防止无限膨胀
    await set({ greetedJobs: arr });
  }
  async function getTask() { const o = await get("task"); return o.task || { active: false }; }
  async function setTask(task) { await set({ task: task }); }
  async function getQueue() {
    const o = await get("queue");
    return o.queue || [];
  }
  async function setQueue(queue) { await set({ queue: queue }); }
  async function getRunState() {
    const o = await get("runState");
    return o.runState || "idle";
  }
  async function setRunState(runState) { await set({ runState: runState }); }

  function today() { return new Date().toISOString().slice(0, 10); }

  async function getDailyCount() {
    const o = await get("dailyCount");
    const dc = o.dailyCount;
    if (!dc || dc.date !== today()) return { date: today(), count: 0 };
    return dc;
  }
  async function incDailyCount() {
    const dc = await getDailyCount();
    dc.count += 1;
    await set({ dailyCount: dc });
    return dc;
  }
  async function addLog(entry) {
    const o = await get("logs");
    const arr = o.logs || [];
    arr.push(Object.assign({ ts: Date.now() }, entry));
    if (arr.length > 500) arr.splice(0, arr.length - 500);
    await set({ logs: arr });
  }
  async function getLogs() {
    const o = await get("logs");
    return o.logs || [];
  }

  window.BAG.store = {
    DEFAULT_CONFIG: DEFAULT_CONFIG, get: get, set: set,
    getConfig: getConfig, setConfig: setConfig,
    getGreeted: getGreeted, addGreeted: addGreeted,
    getQueue: getQueue, setQueue: setQueue,
    getRunState: getRunState, setRunState: setRunState,
    getTask: getTask, setTask: setTask,
    getDailyCount: getDailyCount, incDailyCount: incDailyCount,
    addLog: addLog, getLogs: getLogs, today: today
  };
})();
