// Executor, a state machine that survives page navigation.
// On a search page: select a card, wait for the contact button in the detail pane, then click it,
// which navigates to the chat page.
// On the chat page: optionally send the custom opener, record the result, return to the search page.
// Run state lives in chrome.storage, so step() simply resumes on every page load.
(function () {
  const B = window.BAG;
  async function setStatus(m) { await B.store.set({ statusMsg: m + " · " + new Date().toLocaleTimeString() }); }

  function pageType() {
    const p = location.pathname;
    if (p.indexOf("/web/geek/chat") === 0) return "chat";
    if (B.cities.isSearchPage()) return "search";
    if (p.indexOf("/job_detail/") === 0) return "detail";
    return "other";
  }

  function realClick(el) {
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const rect = el.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, view: window, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    el.dispatchEvent(new MouseEvent("mouseover", opts));
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("click", opts));
  }

  function typeInto(el, text) {
    el.focus();
    if (el.isContentEditable) {
      el.textContent = text;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
    } else {
      const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function pressEnter(el) {
    ["keydown", "keypress", "keyup"].forEach(function (type) {
      el.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 }));
    });
  }

  async function waitFor(getter, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < (timeoutMs || 6000)) {
      if (B.dom.detectCaptcha()) return "captcha";
      const v = getter();
      if (v) return v;
      await B.humanize.sleep(300);
    }
    return null;
  }

  async function interruptibleWait(ms) {
    let w = 0;
    while (w < ms) {
      if ((await B.store.getRunState()) !== "running") return false;
      await B.humanize.sleep(500);
      w += 500;
    }
    return true;
  }

  async function setPaused() { await B.store.setRunState("paused"); chrome.runtime.sendMessage({ type: "state-updated", state: "paused" }); }

  async function markTask(task, status, reason) {
    const q = await B.store.getQueue();
    const it = q.find(function (x) { return x.jobId === task.jobId; });
    if (it) it.status = status;
    await B.store.setQueue(q);
    await B.store.addLog({ jobId: task.jobId, name: task.name, status: status, reason: reason });
    chrome.runtime.sendMessage({ type: "queue-updated" });
  }

  async function handleCaptcha(task) {
    if (task) await B.store.addLog({ jobId: task.jobId, name: task.name, status: "captcha" });
    chrome.runtime.sendMessage({ type: "notify", title: "检测到验证码，已暂停", message: "请手动完成验证后点「开始」继续" });
    await B.store.setTask({ active: false });
    await setStatus("检测到验证码，已暂停");
    await setPaused();
  }

  async function guardOk() {
    if ((await B.store.getRunState()) !== "running") return "stopped";
    const cfg = await B.store.getConfig();
    const dc = await B.store.getDailyCount();
    if (dc.count >= cfg.dailyCap) {
      await B.store.addLog({ status: "paused", reason: "达每日上限" });
      chrome.runtime.sendMessage({ type: "notify", title: "已达每日上限", message: "今日已打招呼 " + dc.count + " 个" });
      await setStatus("已达每日上限 " + dc.count + "，已暂停");
      await setPaused();
      return "cap";
    }
    return "ok";
  }

  function findCard(jobId) {
    const cards = B.dom.getAllCards();
    for (let i = 0; i < cards.length; i++) {
      if (B.dom.extractJobId(cards[i]) === jobId) return cards[i];
    }
    return null;
  }

  const MAX_LOAD_MORE = 40;   // safety cap on how many extra batches we will pull in

  function pickVisible(pendings) {
    for (let i = 0; i < pendings.length; i++) {
      const c = findCard(pendings[i].jobId);
      if (c) return { job: pendings[i], card: c };
    }
    return null;
  }

  // The result list is an infinite-scroll feed. Returning from a chat reloads it with only the
  // first batch rendered, so a queued job further down has no card yet and would look missing.
  // Pull batches in until one of the pending jobs is on screen or the feed stops growing.
  // shouldContinue lets a long hunt be interrupted, so pressing pause takes effect between batches
  // instead of after the whole feed has been walked.
  async function findPendingCard(pendings, onProgress, shouldContinue) {
    let hit = pickVisible(pendings);
    if (hit) return hit;
    for (let n = 0; n < MAX_LOAD_MORE; n++) {
      if (shouldContinue && !(await shouldContinue())) return "stopped";
      const before = B.dom.getAllCards().length;
      if (onProgress) await onProgress(before, n + 1);
      B.scanner.loadMoreCards();
      const grew = await waitFor(function () {
        return B.dom.getAllCards().length > before ? true : null;
      }, 2500);
      if (grew === "captcha") return "captcha";
      if (!grew) return null;                   // reached the bottom of the feed
      await B.scanner.scanOnce();               // batches revealed on the way also join the queue
      const queue = await B.store.getQueue();
      hit = pickVisible(queue.filter(function (q) { return q.approved && q.status === "pending"; }));
      if (hit) return hit;
    }
    return null;
  }

  // Write off queued jobs that the feed no longer shows. Reversible: the scanner puts them back
  // to pending if the same job reappears on a later load.
  async function markUnavailable() {
    const q = await B.store.getQueue();
    let marked = 0;
    q.forEach(function (item) {
      if (item.approved && item.status === "pending") { item.status = "unavailable"; marked++; }
    });
    if (marked) await B.store.setQueue(q);
    return marked;
  }

  async function resumeToSearch() {
    const cfg = await B.store.getConfig();
    if (cfg.searchQuery) location.href = B.cities.buildSearchUrl(cfg);
  }

  async function backToSearch(task) {
    task = task || (await B.store.getTask());
    const url = task.returnUrl || "https://www.zhipin.com/web/geek/jobs";
    await B.store.setTask({ active: false });
    if ((await B.store.getRunState()) === "running") location.href = url;
  }

  // Search page: work through the pending queue, one job per navigation
  async function onSearch() {
    // Cards render asynchronously. Waiting first avoids concluding that a queued job is absent
    // from the page and wrongly marking the whole queue as skipped.
    const ready = await waitFor(function () { return B.dom.getAllCards().length > 0 ? true : null; }, 10000);
    if (ready === "captcha") return handleCaptcha(null);
    if (!ready) { await setStatus("本页未加载出岗位卡片，已暂停"); await setPaused(); return; }

    await B.scanner.scanOnce();

    while (true) {
      if ((await guardOk()) !== "ok") return;
      const queue = await B.store.getQueue();
      const pendings = queue.filter(function (q) { return q.approved && q.status === "pending"; });
      if (!pendings.length) {
        await B.store.setRunState("idle");
        chrome.runtime.sendMessage({ type: "state-updated", state: "idle" });
        await setStatus("队列已处理完，停止");
        return;
      }

      // Only act on jobs whose card is actually present, loading more of the feed when needed.
      // A missing card stays pending rather than being treated as a permanent failure.
      const found = await findPendingCard(pendings, async function (loaded, n) {
        await setStatus("向下加载更多岗位（已加载 " + loaded + " 个，第 " + n + " 次）…");
      }, async function () {
        return (await B.store.getRunState()) === "running";
      });
      if (found === "stopped") return;
      if (found === "captcha") return handleCaptcha(null);
      if (!found) {
        // Walking the whole feed without a hit means nothing on it is actionable. Rather than
        // dead-ending, write the unreachable jobs off as unavailable (the scanner revives them if
        // they show up again) and report the scan numbers so the real cause is visible.
        const marked = await markUnavailable();
        const r = await B.scanner.scanOnce();
        let why = "本页 " + r.total + " 个岗位没有可投的：新增 " + r.added + " · 已在队列 " + r.inQueue +
                  " · 已招呼过 " + r.greeted + " · 不符筛选 " + r.filtered;
        if (r.filtered > 0 && r.topReason) why += "（" + r.topReason + " ×" + r.topCount + "）";
        await setStatus(why + "。队列里 " + marked + " 个岗位在本次搜索中已不存在，标记为「已消失」，之后再刷出来会自动恢复");
        await B.store.setRunState("idle");
        chrome.runtime.sendMessage({ type: "queue-updated" });
        chrome.runtime.sendMessage({ type: "state-updated", state: "idle" });
        return;
      }
      const next = found.job, card = found.card;

      await B.store.setTask({ active: true, jobId: next.jobId, name: next.name, returnUrl: location.href });
      const cfg = await B.store.getConfig();
      // One configured gap, jittered so the rhythm never becomes exactly periodic
      const waitMs = B.humanize.jitter(cfg.intervalSec * 1000, 0.3);
      await setStatus("等待 " + Math.round(waitMs / 1000) + "s 后处理：" + next.name);
      if (!(await interruptibleWait(waitMs))) return;

      await setStatus("选择岗位：" + next.name);
      realClick(card.querySelector(B.selectors.jobName) || card); // selecting a card refreshes the detail pane
      await B.humanize.sleep(B.humanize.randInt(1000, 1800));
      if (B.dom.detectCaptcha()) return handleCaptcha(next);

      const btn = await waitFor(function () { return B.dom.findChatButton(); }, 6000);
      if (btn === "captcha") return handleCaptcha(next);
      if (!btn) { await markTask(next, "skipped", "右侧未找到沟通按钮"); await B.store.setTask({ active: false }); continue; }

      const btnText = (btn.textContent || "").trim();
      if (btnText.indexOf("继续沟通") !== -1) { // already contacted, skip instead of messaging twice
        await markTask(next, "skipped", "已沟通过");
        await B.store.addGreeted([next.jobId]);
        await B.store.setTask({ active: false });
        continue;
      }

      await setStatus("点击“立即沟通”：" + next.name);
      realClick(btn); // navigates to the chat page, where onChat takes over
      return;
    }
  }

  // Fallback for landing on a standalone detail page with a task in flight. Not the normal path.
  async function onDetail() {
    const task = await B.store.getTask();
    if (!task.active) return resumeToSearch();
    if ((await guardOk()) !== "ok") return;
    await setStatus("详情页：查找“立即沟通”…");
    await B.humanize.sleep(B.humanize.randInt(800, 1500));
    const btn = await waitFor(function () { return B.dom.findChatButton(); }, 6000);
    if (btn === "captcha") return handleCaptcha(task);
    if (!btn) { await markTask(task, "skipped", "详情页未找到沟通按钮"); return backToSearch(task); }
    if ((btn.textContent || "").indexOf("继续沟通") !== -1) { await markTask(task, "skipped", "已沟通过"); await B.store.addGreeted([task.jobId]); return backToSearch(task); }
    realClick(btn);
  }

  // Chat page: send the optional custom opener, record the result, then return to the search page
  async function onChat() {
    const task = await B.store.getTask();
    if (!task.active) return resumeToSearch();
    if (B.dom.detectCaptcha()) return handleCaptcha(task);

    const cfg = await B.store.getConfig();
    const greeting = (cfg.greeting || "").trim();
    let note = null;
    if (greeting) {
      await setStatus("发送招呼语…");
      const input = await waitFor(function () { return B.dom.findChatInput(); }, 6000);
      if (input === "captcha") return handleCaptcha(task);
      if (input) {
        await B.humanize.sleep(B.humanize.randInt(500, 1200));
        typeInto(input, greeting);
        await B.humanize.sleep(B.humanize.randInt(600, 1400));
        const sendBtn = B.dom.findSendButton();
        if (sendBtn) realClick(sendBtn); else pressEnter(input);
      } else {
        note = "自定义招呼语未送达(聊天输入框未找到)，默认招呼语已发";
      }
    }
    await setStatus("已招呼：" + task.name + "，返回列表…");
    await markTask(task, "greeted", note);
    await B.store.addGreeted([task.jobId]);
    await B.store.incDailyCount();
    await B.humanize.sleep(B.humanize.randInt(1500, 3000));
    backToSearch(task);
  }

  async function step() {
    if ((await B.store.getRunState()) !== "running") return;
    const t = pageType();
    if (t === "chat") return onChat();
    if (t === "search") return onSearch();
    if (t === "detail") return onDetail();
    // other page types are left to the panel's autoScan
  }

  async function run() {
    await B.store.setRunState("running");
    chrome.runtime.sendMessage({ type: "state-updated", state: "running" });
    step();
  }
  async function pause() { await B.store.setRunState("paused"); chrome.runtime.sendMessage({ type: "state-updated", state: "paused" }); }
  async function stop() { await B.store.setRunState("idle"); await B.store.setTask({ active: false }); chrome.runtime.sendMessage({ type: "state-updated", state: "idle" }); }

  B.executor = { run: run, pause: pause, stop: stop, step: step, findPendingCard: findPendingCard, markUnavailable: markUnavailable };
})();
