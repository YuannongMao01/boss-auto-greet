// Wrapper around chrome.storage.local: config, greeted job ids, queue, run state, daily count, logs.
window.BAG = window.BAG || {};
(function () {
  const DEFAULT_CONFIG = {
    searchQuery: "",       // single term handed to the Boss search box
    mustInclude: [],       // terms that must appear literally in a result (all of them)
    excludeKeywords: [],   // blacklist, a single hit rejects the job
    cities: [],            // accepted cities, matched against the job location
    minSalary: 0,          // minimum salary in K, 0 means no limit
    todayOnly: false,      // unused, Boss cards carry no publish time
    greeting: "",          // custom opener, empty means rely on the account default
    dailyCap: 40,          // max greetings per day
    intervalMin: 8,        // minimum gap between greetings, seconds
    intervalMax: 30,       // maximum gap between greetings, seconds
    workStart: "09:00",    // start of the allowed time window
    workEnd: "20:00"       // end of the allowed time window
  };

  function get(keys) { return new Promise(function (r) { chrome.storage.local.get(keys, r); }); }
  function set(obj) { return new Promise(function (r) { chrome.storage.local.set(obj, r); }); }

  async function getConfig() {
    const o = await get("config");
    const c = Object.assign({}, DEFAULT_CONFIG, o.config || {});
    // Migrate the legacy shape: keywords[0] -> searchQuery, the rest -> mustInclude
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

  // Greeted set: written only when a greeting actually completed. Permanent, with no reset entry point.
  // An older build wrote every scanned card into seenJobs, so on first read the real record is
  // rebuilt from the logs and the polluted key is dropped.
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
    if (arr.length > 5000) arr = arr.slice(arr.length - 5000); // cap the set so it cannot grow without bound
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
