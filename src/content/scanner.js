// Scanner: parse the job cards on the current page, filter, deduplicate, then push candidates
// into the queue. Deduplication skips jobs already queued and jobs already greeted; everything
// else that matches is enqueued.
(function () {
  const B = window.BAG;
  let observer = null;
  let scanning = false;

  async function scanOnce() {
    const config = await B.store.getConfig();
    const greeted = await B.store.getGreeted();   // contains only genuinely greeted job ids
    const queue = await B.store.getQueue();
    const existing = new Set(queue.map(function (q) { return q.jobId; }));
    const byId = {};
    queue.forEach(function (q) { byId[q.jobId] = q; });
    const cards = B.dom.getAllCards();
    const toAdd = [];
    let inQueue = 0, greetedSkip = 0, filtered = 0, revived = 0;
    const reasonTally = {};   // tally rejection reasons so the panel can explain an empty result

    // Every card is parsed up front, because the placeholder logo can only be recognised by
    // comparing the whole page: it is the one image several different companies share.
    const parsed = cards.map(function (c) { return B.dom.parseCard(c); });
    const placeholders = B.filters.detectPlaceholderLogos(parsed);

    for (let i = 0; i < parsed.length; i++) {
      const job = parsed[i];
      job.logoIsDefault = B.filters.isDefaultLogo(job.logo, placeholders);
      if (!job.jobId) continue;
      if (greeted.has(job.jobId)) { greetedSkip++; continue; }
      const known = byId[job.jobId];
      if (known) {
        // The feed reshuffles between loads, so a job written off as unavailable can come back.
        // Put it in play again rather than ignoring it forever.
        if (known.status === "unavailable" && B.filters.matches(job, config).ok) {
          known.status = "pending";
          known.approved = true;
          revived++;
        } else {
          inQueue++;
        }
        continue;
      }
      if (existing.has(job.jobId)) { inQueue++; continue; }
      const verdict = B.filters.matches(job, config);
      if (!verdict.ok) {
        filtered++;
        const r = verdict.reason || "不符筛选";
        reasonTally[r] = (reasonTally[r] || 0) + 1;
        continue;
      }
      existing.add(job.jobId); // guard against duplicates within a single scan
      toAdd.push({
        jobId: job.jobId, name: job.name, salary: job.salary, company: job.company,
        location: job.location, tags: job.tags, url: job.url,
        approved: true, status: "pending"
      });
    }

    if (toAdd.length || revived) {
      await B.store.setQueue(queue.concat(toAdd));
      chrome.runtime.sendMessage({ type: "queue-updated" });
      chrome.runtime.sendMessage({ type: "notify", title: "发现新岗位", message: toAdd.length + " 个新岗位进入队列" });
      B.log("log", "queued new candidates", toAdd.length, "revived", revived);
    }
    // Pick the single most common rejection reason
    let topReason = "", topCount = 0;
    Object.keys(reasonTally).forEach(function (r) {
      if (reasonTally[r] > topCount) { topCount = reasonTally[r]; topReason = r; }
    });
    return {
      total: cards.length, added: toAdd.length, inQueue: inQueue, greeted: greetedSkip,
      filtered: filtered, revived: revived,
      topReason: topReason, topCount: topCount, reasons: reasonTally
    };
  }

  function startObserving() {
    if (scanning) return;
    scanning = true;
    scanOnce();
    observer = new MutationObserver(function () {
      clearTimeout(window.__bagScanTimer);
      window.__bagScanTimer = setTimeout(scanOnce, 800); // debounce, so a busy DOM collapses into one scan
    });
    observer.observe(document.body, { childList: true, subtree: true });
    B.log("log", "scanner started");
  }

  function stopObserving() {
    scanning = false;
    if (observer) observer.disconnect();
    observer = null;
  }

  B.scanner = { scanOnce: scanOnce, startObserving: startObserving, stopObserving: stopObserving };
})();
