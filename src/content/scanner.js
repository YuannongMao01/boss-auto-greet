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

  // Scroll the feed by one batch. The last card is scrolled into view rather than moving the
  // window, so this also works when the list lives inside its own scrolling container.
  function loadMoreCards() {
    const cards = B.dom.getAllCards();
    if (cards.length) cards[cards.length - 1].scrollIntoView({ block: "end", behavior: "smooth" });
    else window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
  }

  async function waitForGrowth(before, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < (timeoutMs || 2500)) {
      if (B.dom.getAllCards().length > before) return true;
      await B.humanize.sleep(300);
    }
    return false;
  }

  // scanOnce only ever sees the batch the page has rendered, so anything further down the feed
  // used to require the user to scroll there first. scanAll walks the entire result list instead:
  // scan, pull the next batch, scan again, until the feed stops growing. Interruptible between
  // batches, and it gives up as soon as a captcha appears rather than hammering the site.
  const MAX_SCAN_BATCHES = 60;

  async function scanAll(onProgress, shouldContinue) {
    let r = await scanOnce();
    let added = r.added, batches = 1, stopped = "";
    for (; batches <= MAX_SCAN_BATCHES; batches++) {
      if (B.dom.detectCaptcha()) { stopped = "captcha"; break; }
      if (shouldContinue && !(await shouldContinue())) { stopped = "stopped"; break; }
      const before = B.dom.getAllCards().length;
      if (onProgress) await onProgress({ cards: before, added: added, batch: batches });
      loadMoreCards();
      if (!(await waitForGrowth(before, 2500))) break;   // reached the end of the feed
      r = await scanOnce();
      added += r.added;
    }
    // One last pass, so a batch that arrived after the growth wait still gets counted. scanOnce
    // rescans every rendered card, so its totals already describe the whole loaded feed.
    const final = await scanOnce();
    return Object.assign({}, final, { added: added + final.added, batches: batches, stopped: stopped });
  }

  // ---- 公司规模 sweep -------------------------------------------------------------------------
  // One search only ever exposes a capped window of results, so the same query is run once per
  // 公司规模 value: round one carries no scale at all, then one single code per round. Each round
  // is its own result window, which is how jobs beyond the cap become reachable. Never several
  // codes at once, that would just be one wider window with the same cap.
  const MAX_SHARDS = 12;
  const MAX_NAV_TRIES = 3;

  async function setStatus(m) { await B.store.set({ statusMsg: m + " · " + new Date().toLocaleTimeString() }); }
  function shardLabel(shard) { return shard ? "规模 " + shard : "不限规模"; }

  async function sweepStart() {
    const cfg = await B.store.getConfig();
    const order = (cfg.scaleOrder || []).filter(Boolean);
    const shards = [""].concat(order).slice(0, MAX_SHARDS);   // the unfiltered round always goes first
    await B.store.setSweep({ active: true, shards: shards, idx: 0, added: 0, tries: 0, rounds: [] });
    await sweepStep();
  }

  async function sweepStop() {
    const sw = await B.store.getSweep();
    sw.active = false;
    await B.store.setSweep(sw);
  }

  async function sweepFinish(sw, cfg) {
    const parts = sw.rounds.map(function (r) {
      return shardLabel(r.shard) + " " + r.total + "→+" + r.added + (r.skipped ? "（跳过）" : "");
    });
    sw.active = false;
    await B.store.setSweep(sw);
    await setStatus("规模轮扫完成，共入队 " + sw.added + " 个新岗位｜" + parts.join(" · "));
    // Leave the page on the plain search rather than on the last round's filter
    if (B.cities.scaleOf(location.search)) location.href = B.cities.buildSearchUrl(cfg, "");
  }

  async function sweepStep() {
    let sw = await B.store.getSweep();
    if (!sw.active) return;
    const cfg = await B.store.getConfig();
    if (sw.idx >= sw.shards.length) return sweepFinish(sw, cfg);
    const shard = sw.shards[sw.idx];
    const round = (sw.idx + 1) + "/" + sw.shards.length;

    // Make sure the page really is this round before scanning it, otherwise the numbers would be
    // attributed to the wrong filter. A round that cannot be reached is skipped rather than retried
    // forever, which is what keeps a rejected or rewritten parameter from looping.
    if (!B.cities.onShardAt(cfg, shard, location.pathname, location.search)) {
      if (sw.tries >= MAX_NAV_TRIES) {
        sw.rounds.push({ shard: shard, total: 0, added: 0, skipped: true });
        sw.idx += 1; sw.tries = 0;
        await B.store.setSweep(sw);
        if (sw.idx >= sw.shards.length) return sweepFinish(sw, cfg);
        location.href = B.cities.buildSearchUrl(cfg, sw.shards[sw.idx]);
        return;
      }
      sw.tries += 1;
      await B.store.setSweep(sw);
      await setStatus("规模轮扫 " + round + "：打开" + shardLabel(shard) + "的列表…");
      location.href = B.cities.buildSearchUrl(cfg, shard);
      return;
    }

    sw.tries = 0;
    await B.store.setSweep(sw);
    const r = await scanAll(async function (p) {
      await setStatus("规模轮扫 " + round + "（" + shardLabel(shard) + "）：已加载 " + p.cards +
                      " 个卡片 · 本轮入队 " + p.added);
    }, async function () { return (await B.store.getSweep()).active; });

    sw = await B.store.getSweep();
    if (!sw.active) { await setStatus("规模轮扫已停止，共入队 " + (sw.added + r.added) + " 个新岗位"); return; }
    sw.added += r.added;
    sw.rounds.push({ shard: shard, total: r.total, added: r.added });
    sw.idx += 1;
    await B.store.setSweep(sw);

    if (r.stopped === "captcha") {
      await setStatus("出现验证码，规模轮扫已停止，共入队 " + sw.added + " 个新岗位");
      return sweepStop();
    }
    if (sw.idx >= sw.shards.length) return sweepFinish(sw, cfg);
    location.href = B.cities.buildSearchUrl(cfg, sw.shards[sw.idx]);
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

  B.scanner = {
    scanOnce: scanOnce, scanAll: scanAll, loadMoreCards: loadMoreCards,
    sweepStart: sweepStart, sweepStep: sweepStep, sweepStop: sweepStop,
    MAX_SHARDS: MAX_SHARDS, MAX_NAV_TRIES: MAX_NAV_TRIES,
    startObserving: startObserving, stopObserving: stopObserving,
    MAX_SCAN_BATCHES: MAX_SCAN_BATCHES
  };
})();
