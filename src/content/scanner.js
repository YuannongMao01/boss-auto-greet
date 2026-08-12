// 扫描器：解析当前页岗位卡片 -> 过滤 -> 去重 -> 推入候选队列。纯只读，不触发任何写操作。
// 去重规则：跳过①已在队列中 ②已打过招呼(greeted 集合) 的岗位；其余匹配即入队。
(function () {
  const B = window.BAG;
  let observer = null;
  let scanning = false;

  async function scanOnce() {
    const config = await B.store.getConfig();
    const greeted = await B.store.getGreeted();   // 只含“真正打过招呼”的 jobId
    const queue = await B.store.getQueue();
    const existing = new Set(queue.map(function (q) { return q.jobId; }));
    const cards = B.dom.getAllCards();
    const toAdd = [];
    let inQueue = 0, greetedSkip = 0, filtered = 0;
    const reasonTally = {};   // 记录被过滤的原因，便于面板提示“为什么全被过滤了”

    for (let i = 0; i < cards.length; i++) {
      const job = B.dom.parseCard(cards[i]);
      if (!job.jobId) continue;
      if (existing.has(job.jobId)) { inQueue++; continue; }
      if (greeted.has(job.jobId)) { greetedSkip++; continue; }
      const verdict = B.filters.matches(job, config);
      if (!verdict.ok) {
        filtered++;
        const r = verdict.reason || "不符筛选";
        reasonTally[r] = (reasonTally[r] || 0) + 1;
        continue;
      }
      existing.add(job.jobId); // 防同一次扫描内重复
      toAdd.push({
        jobId: job.jobId, name: job.name, salary: job.salary, company: job.company,
        location: job.location, tags: job.tags, url: job.url,
        approved: true, status: "pending"
      });
    }

    if (toAdd.length) {
      await B.store.setQueue(queue.concat(toAdd));
      chrome.runtime.sendMessage({ type: "queue-updated" });
      chrome.runtime.sendMessage({ type: "notify", title: "发现新岗位", message: toAdd.length + " 个新岗位进入队列" });
      B.log("log", "新增候选", toAdd.length);
    }
    // 找出最主要的过滤原因
    let topReason = "", topCount = 0;
    Object.keys(reasonTally).forEach(function (r) {
      if (reasonTally[r] > topCount) { topCount = reasonTally[r]; topReason = r; }
    });
    return {
      total: cards.length, added: toAdd.length, inQueue: inQueue, greeted: greetedSkip,
      filtered: filtered, topReason: topReason, topCount: topCount, reasons: reasonTally
    };
  }

  function startObserving() {
    if (scanning) return;
    scanning = true;
    scanOnce();
    observer = new MutationObserver(function () {
      clearTimeout(window.__bagScanTimer);
      window.__bagScanTimer = setTimeout(scanOnce, 800); // 防抖：DOM 频繁变动时合并扫描
    });
    observer.observe(document.body, { childList: true, subtree: true });
    B.log("log", "扫描已启动");
  }

  function stopObserving() {
    scanning = false;
    if (observer) observer.disconnect();
    observer = null;
  }

  B.scanner = { scanOnce: scanOnce, startObserving: startObserving, stopObserving: stopObserving };
})();
