// 执行器（跨页面状态机，搜索页内点选版）：
// 搜索页：选中卡片 -> 右侧详情面板出现“立即沟通” -> 点击 -> 跳聊天页
// 聊天页：(发自定义招呼语) -> 计数/标记 -> 跳回搜索页 -> 继续
// 不再跳转独立 job_detail.html（会被 Boss 重定向弹回）。
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

  function inWorkHours(config) {
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    const s = config.workStart.split(":").map(Number);
    const e = config.workEnd.split(":").map(Number);
    return cur >= s[0] * 60 + s[1] && cur <= e[0] * 60 + e[1];
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
    if (!inWorkHours(cfg)) { await B.store.addLog({ status: "paused", reason: "非工作时段" }); await setStatus("非工作时段，已暂停"); await setPaused(); return "paused"; }
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

  // 搜索页：循环处理待办 —— 选中卡片 -> 右侧“立即沟通” -> 点击进聊天
  async function onSearch() {
    // 关键：先等岗位卡片渲染出来，否则会误判“卡片不在本页”把队列全标成跳过
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

      // 只处理“本页确实存在卡片”的岗位；找不到的保留待处理，不销毁
      let next = null, card = null;
      for (let i = 0; i < pendings.length; i++) {
        const c = findCard(pendings[i].jobId);
        if (c) { next = pendings[i]; card = c; break; }
      }
      if (!next) {
        await setStatus("本页找不到这 " + pendings.length + " 个待办岗位的卡片（可能属于别的搜索词），已暂停。切到对应搜索页再点开始，或清空队列");
        await setPaused();
        return;
      }

      await B.store.setTask({ active: true, jobId: next.jobId, name: next.name, returnUrl: location.href });
      const cfg = await B.store.getConfig();
      const waitMs = B.humanize.delayMs(cfg.intervalMin, cfg.intervalMax);
      await setStatus("等待 " + Math.round(waitMs / 1000) + "s 后处理：" + next.name);
      if (!(await interruptibleWait(waitMs))) return;

      await setStatus("选择岗位：" + next.name);
      realClick(card.querySelector(B.selectors.jobName) || card); // 选中 -> 右侧详情更新
      await B.humanize.sleep(B.humanize.randInt(1000, 1800));
      if (B.dom.detectCaptcha()) return handleCaptcha(next);

      const btn = await waitFor(function () { return B.dom.findChatButton(); }, 6000);
      if (btn === "captcha") return handleCaptcha(next);
      if (!btn) { await markTask(next, "skipped", "右侧未找到沟通按钮"); await B.store.setTask({ active: false }); continue; }

      const btnText = (btn.textContent || "").trim();
      if (btnText.indexOf("继续沟通") !== -1) { // 已联系过，跳过不重复骚扰
        await markTask(next, "skipped", "已沟通过");
        await B.store.addGreeted([next.jobId]);
        await B.store.setTask({ active: false });
        continue;
      }

      await setStatus("点击“立即沟通”：" + next.name);
      realClick(btn); // -> 跳聊天页，onChat 接管
      return;
    }
  }

  // 兜底：万一落到独立详情页且任务在，尝试点沟通（正常流程不走这里）
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

  // 聊天页：发自定义招呼语(可选) -> 计数/标记 -> 跳回搜索页
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
    // other: 交给面板 autoScan
  }

  async function run() {
    await B.store.setRunState("running");
    chrome.runtime.sendMessage({ type: "state-updated", state: "running" });
    step();
  }
  async function pause() { await B.store.setRunState("paused"); chrome.runtime.sendMessage({ type: "state-updated", state: "paused" }); }
  async function stop() { await B.store.setRunState("idle"); await B.store.setTask({ active: false }); chrome.runtime.sendMessage({ type: "state-updated", state: "idle" }); }

  B.executor = { run: run, pause: pause, stop: stop, step: step };
})();
