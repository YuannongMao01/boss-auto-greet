// Injected sidebar panel: one primary start/pause control, a collapsed advanced menu, and the queue.
(function () {
  const B = window.BAG;
  const BAG_VERSION = "v1";  // Shown in the panel title so you can confirm which build the tab loaded
  let root = null;

  function el(tag, cls, txt) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }
  function stateLabel(s) { return { idle: "空闲", running: "运行中", paused: "已暂停" }[s] || s; }
  function statusLabel(s) { return { pending: "待处理", greeted: "已招呼", skipped: "跳过", unavailable: "已消失", captcha: "验证码", error: "错误" }[s] || s; }

  function showMsg(text) {
    if (!root) return;
    const m = root.querySelector(".bag-msg");
    if (m) { m.textContent = text; m.style.display = "block"; }
  }

  function closeDebug() {
    if (!root) return;
    const box = root.querySelector(".bag-debugbox");
    if (box) { box.style.display = "none"; box.innerHTML = ""; }
    const b = root.querySelector(".bag-dbgbtn");
    if (b) b.textContent = "调试";
  }

  // Bulk approval. Only pending rows are touched, since greeted or skipped ones can no longer act.
  async function setAllApproved(approved) {
    const q = await B.store.getQueue();
    let changed = 0, actionable = 0;
    q.forEach(function (item) {
      if (item.status !== "pending") return;
      actionable++;
      if (item.approved !== approved) { item.approved = approved; changed++; }
    });
    if (changed) await B.store.setQueue(q);
    if (!actionable) showMsg("队列里没有待处理的岗位");
    else if (!changed) showMsg(approved ? "待处理岗位已经全部勾选" : "待处理岗位已经全部取消勾选");
    else showMsg((approved ? "已勾选 " : "已取消勾选 ") + changed + " 个待处理岗位");
    render();
  }

  async function render() {
    if (!root) return;
    const queue = await B.store.getQueue();
    const state = await B.store.getRunState();
    const dc = await B.store.getDailyCount();
    const config = await B.store.getConfig();

    const stat = root.querySelector(".bag-stat");
    const pending = queue.filter(function (q) { return q.status === "pending"; }).length;
    stat.textContent = "状态: " + stateLabel(state) + " · 今日 " + dc.count + "/" + config.dailyCap + " · 待处理 " + pending;

    // Standing notice when the page on screen is not the search the config describes
    const hint = root.querySelector(".bag-hint");
    if (config.searchQuery && state !== "running" && !B.cities.searchMatches(config)) {
      hint.textContent = B.cities.isSearchPage()
        ? "本页搜的是「" + B.cities.currentQuery() + "」，设置里是「" + config.searchQuery + "」 → 点「开始打招呼」会先跳转"
        : "当前不在搜索页 → 点「开始打招呼」会跳到「" + config.searchQuery + "」的搜索页";
      hint.style.display = "block";
    } else {
      hint.style.display = "none";
    }

    const main = root.querySelector(".bag-main");
    if (state === "running") { main.textContent = "暂停"; main.classList.add("bag-running"); }
    else { main.textContent = "开始打招呼"; main.classList.remove("bag-running"); }

    // List header: counts plus the two bulk actions, hidden when nothing is actionable
    const listHead = root.querySelector(".bag-listhead");
    const pendingItems = queue.filter(function (q) { return q.status === "pending"; });
    const approvedCount = pendingItems.filter(function (q) { return q.approved; }).length;
    if (pendingItems.length) {
      listHead.style.display = "flex";
      root.querySelector(".bag-counts").textContent =
        "待处理 " + pendingItems.length + " 个 · 已勾选 " + approvedCount;
      root.querySelector(".bag-selall").disabled = approvedCount === pendingItems.length;
      root.querySelector(".bag-selnone").disabled = approvedCount === 0;
    } else {
      listHead.style.display = "none";
    }

    const list = root.querySelector(".bag-list");
    list.innerHTML = "";
    queue.slice().reverse().forEach(function (job) {
      const row = el("div", "bag-row bag-" + job.status);
      const cb = el("input");
      cb.type = "checkbox";
      cb.checked = job.approved;
      cb.disabled = job.status !== "pending";
      cb.onchange = async function () {
        const q = await B.store.getQueue();
        const it = q.find(function (x) { return x.jobId === job.jobId; });
        if (it) it.approved = cb.checked;
        await B.store.setQueue(q);
      };
      const info = el("div", "bag-info");
      info.appendChild(el("div", "bag-name", job.name || "(无名)"));
      info.appendChild(el("div", "bag-sub", (job.salary || "") + " · " + (job.company || "")));
      info.appendChild(el("div", "bag-sub2", (job.location || "") + " · " + statusLabel(job.status)));
      row.appendChild(cb);
      row.appendChild(info);
      list.appendChild(row);
    });
  }

  // Primary control, toggling between start and pause. Starting from a non-search page navigates
  // to the configured search page first.
  async function onMain() {
    const state = await B.store.getRunState();
    if (state === "running") { await B.executor.pause(); showMsg("已暂停（当前动作完成后停下）"); render(); return; }
    const cfg = await B.store.getConfig();
    if (!cfg.searchQuery) { showMsg("请先点扩展图标，在「搜索词」里填岗位关键词"); return; }
    // Not merely "is this a search page" but "is this the search the config asks for", so editing
    // the search term and pressing start navigates instead of silently reusing the old results.
    if (!B.cities.searchMatches(cfg)) {
      await B.store.setRunState("running");
      showMsg("正在按最新设置打开搜索页…");
      location.href = B.cities.buildSearchUrl(cfg); // init() resumes step() once the page has loaded
      return;
    }
    await B.executor.run();
    showMsg("开始运行，按拟人节奏逐个打招呼…");
    render();
  }

  // Keep the panel inside the viewport, leaving the header reachable at the bottom edge
  function clampPos(x, y, w) {
    const maxX = Math.max(0, window.innerWidth - w - 4);
    const maxY = Math.max(0, window.innerHeight - 40);
    return { x: Math.min(Math.max(0, x), maxX), y: Math.min(Math.max(0, y), maxY) };
  }

  // Drag by the header. Listeners are registered in the capture phase so the host page's own
  // handlers cannot swallow the gesture.
  function enableDrag(handle) {
    let startX = 0, startY = 0, originX = 0, originY = 0, dragging = false;
    handle.addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      if (e.target.classList.contains("bag-toggle")) return;   // leave the collapse control clickable
      const r = root.getBoundingClientRect();
      dragging = true;
      startX = e.clientX; startY = e.clientY; originX = r.left; originY = r.top;
      root.style.left = r.left + "px";
      root.style.top = r.top + "px";
      root.style.right = "auto";
      root.classList.add("bag-dragging");
      e.preventDefault(); e.stopPropagation();
    }, true);
    document.addEventListener("mousemove", function (e) {
      if (!dragging) return;
      const c = clampPos(originX + e.clientX - startX, originY + e.clientY - startY, root.offsetWidth);
      root.style.left = c.x + "px";
      root.style.top = c.y + "px";
      e.preventDefault();
    }, true);
    document.addEventListener("mouseup", function () {
      if (!dragging) return;
      dragging = false;
      root.classList.remove("bag-dragging");
      const r = root.getBoundingClientRect();
      B.store.set({ panelPos: { x: r.left, y: r.top } });
    }, true);
  }

  // Restore the position and collapsed state saved before the last navigation
  async function restoreLayout() {
    const o = await B.store.get(["panelPos", "panelCollapsed"]);
    if (o.panelPos) {
      const c = clampPos(o.panelPos.x, o.panelPos.y, root.offsetWidth);
      root.style.left = c.x + "px";
      root.style.top = c.y + "px";
      root.style.right = "auto";
    }
    if (o.panelCollapsed) {
      root.classList.add("bag-collapsed");
      const t = root.querySelector(".bag-toggle");
      if (t) t.textContent = "+";
    }
  }

  function build() {
    root = el("div", "bag-panel");

    const head = el("div", "bag-head");
    head.appendChild(el("span", "bag-title", "Boss Auto Greet · " + BAG_VERSION));
    const toggle = el("span", "bag-toggle", "—");
    toggle.title = "折叠/展开";
    toggle.onclick = function () {
      const collapsed = root.classList.toggle("bag-collapsed");
      toggle.textContent = collapsed ? "+" : "—";
      B.store.set({ panelCollapsed: collapsed });
    };
    head.appendChild(toggle);
    root.appendChild(head);
    enableDrag(head);

    // Action stack, flat and always visible: primary control, the two queue actions, then debug
    const actions = el("div", "bag-actions");
    const main = el("button", "bag-main", "开始打招呼");
    main.onclick = onMain;
    actions.appendChild(main);

    const secondary = el("div", "bag-secondary");
    const rescan = el("button", null, "扫描本页");
    rescan.onclick = async function () {
      const r = await B.scanner.scanOnce();
      if (r.total === 0) showMsg("本页 0 个卡片 ← 选择器需校准，点「调试」看结构");
      else {
        let m = "本页 " + r.total + " 个卡片：新增 " + r.added + " · 已在队列 " + r.inQueue +
                " · 已招呼过 " + r.greeted + " · 不符筛选 " + r.filtered;
        if (r.revived) m += " · 恢复 " + r.revived;
        if (r.filtered > 0 && r.topReason) m += "（主要原因：" + r.topReason + " ×" + r.topCount + "）";
        showMsg(m);
      }
      render();
    };
    const clear = el("button", null, "清空队列");
    clear.onclick = async function () { await B.store.setQueue([]); showMsg("队列已清空（未招呼的可重新扫描加回）"); render(); };
    const debug = el("button", "bag-dbgbtn", "调试");
    debug.onclick = async function () {
      const box0 = root.querySelector(".bag-debugbox");
      if (box0.style.display !== "none") { closeDebug(); return; } // a second click collapses the box
      const cards = B.dom.getAllCards();
      const cfg = await B.store.getConfig();
      const parsed = cards[0] ? B.dom.parseCard(cards[0]) : null;
      if (parsed) delete parsed._raw;
      let html = cards[0] ? cards[0].outerHTML : "(未匹配到卡片)";
      if (html.length > 6000) html = html.slice(0, 6000) + "\n...(已截断)";
      const box = root.querySelector(".bag-debugbox");
      box.style.display = "block";
      box.innerHTML = "";
      const hdr = el("div", "bag-dbg-h", "调试信息（全选复制发我，无需开控制台）");
      const xBtn = el("span", "bag-dbg-x", "✕");
      xBtn.title = "关闭调试信息";
      xBtn.onclick = closeDebug;
      hdr.appendChild(xBtn);
      box.appendChild(hdr);
      const ta = el("textarea", "bag-dbg-ta");
      ta.readOnly = true;
      const dd = (await B.store.get("detailDump")).detailDump;
      let ddText = "";
      if (dd) ddText = "\n\n[详情页诊断] URL:\n" + dd.url + "\n可点击文字(<=10字):\n" + JSON.stringify(dd.buttons);
      function desc(e) { return e.tagName.toLowerCase() + " ." + (String(e.className || "").replace(/\s+/g, ".").slice(0, 70)) + "  【" + (e.textContent || "").trim().slice(0, 20) + "】"; }
      // Contact-like elements, listed first so they never fall past the truncation limit
      const chatLike = Array.prototype.slice.call(document.querySelectorAll("a, button, span, div"))
        .filter(function (e) { const t = (e.textContent || "").trim(); return e.offsetParent !== null && t.length <= 8 && /沟通|立即|打招呼|聊/.test(t); })
        .map(desc);
      const chatText = "\n\n[★沟通类按钮]\n" + (chatLike.length ? Array.from(new Set(chatLike)).slice(0, 30).join("\n") : "(主页面未找到，可能在 iframe 里)");
      // Frame inventory
      const frames = Array.prototype.slice.call(document.querySelectorAll("iframe")).map(function (f) { return f.src || "(无src)"; });
      const frameText = "\n\n[iframe 数量 " + frames.length + "]\n" + frames.slice(0, 10).join("\n");
      // General clickable elements, with empty-label noise removed
      const clk = Array.prototype.slice.call(document.querySelectorAll("button, a[class*='btn'], a[class*='chat'], [class*='btn']"))
        .filter(function (e) { return e.offsetParent !== null; }).map(desc)
        .filter(function (t) { return t.indexOf("【】") === -1; });
      const clkText = chatText + frameText + "\n\n[按钮类元素]\n" + Array.from(new Set(clk)).slice(0, 60).join("\n");
      ta.value = "调试格式版本: " + BAG_VERSION + "（若面板标题不是这个版本，说明扩展或页面没刷新！）\n当前页面: " + location.href + "\n卡片数量: " + cards.length + "\n\n当前配置:\n" + JSON.stringify(cfg, null, 2) +
        "\n\n首个卡片解析结果:\n" + JSON.stringify(parsed, null, 2) + "\n\n首个卡片 HTML:\n" + html + ddText + clkText;
      ta.onclick = function () { ta.select(); };
      box.appendChild(ta);
      const copyBtn = el("button", "bag-dbg-copy", "复制全部");
      copyBtn.onclick = function () {
        ta.select();
        navigator.clipboard.writeText(ta.value).then(function () { copyBtn.textContent = "已复制 ✓"; },
          function () { document.execCommand("copy"); copyBtn.textContent = "已复制 ✓"; });
      };
      box.appendChild(copyBtn);
      debug.textContent = "关闭调试";
    };
    secondary.appendChild(rescan);
    secondary.appendChild(clear);
    actions.appendChild(secondary);
    actions.appendChild(debug);
    root.appendChild(actions);

    // Status row
    root.appendChild(el("div", "bag-stat"));

    const hint = el("div", "bag-hint");
    hint.style.display = "none";
    root.appendChild(hint);

    const msg = el("div", "bag-msg");
    msg.style.display = "none";
    root.appendChild(msg);

    const dbgbox = el("div", "bag-debugbox");
    dbgbox.style.display = "none";
    root.appendChild(dbgbox);

    const listHead = el("div", "bag-listhead");
    listHead.style.display = "none";
    listHead.appendChild(el("span", "bag-counts"));
    const selOps = el("div", "bag-selops");
    const selAll = el("button", "bag-selall", "全选");
    selAll.onclick = function () { setAllApproved(true); };
    const selNone = el("button", "bag-selnone", "全不选");
    selNone.onclick = function () { setAllApproved(false); };
    selOps.appendChild(selAll);
    selOps.appendChild(selNone);
    listHead.appendChild(selOps);
    root.appendChild(listHead);

    root.appendChild(el("div", "bag-list"));
    document.body.appendChild(root);
  }

  chrome.runtime.onMessage.addListener(function (msg) {
    if (["queue-updated", "state-updated", "progress"].indexOf(msg.type) !== -1) render();
  });

  // storage.onChanged fires inside the sending context too, unlike chrome.runtime.sendMessage,
  // which makes it the reliable channel for same-page status updates
  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== "local") return;
      if (changes.statusMsg && changes.statusMsg.newValue) showMsg(changes.statusMsg.newValue);
      if (changes.queue || changes.runState || changes.dailyCount) render();
    });
  }

  async function maybeAutoNavigate() {
    const cfg = await B.store.getConfig();
    if (!cfg.autoScan) return false;
    if (B.cities.isSearchPage()) return false;
    if (!cfg.searchQuery) return false;
    B.log("log", "auto-navigating to the search page");
    location.href = B.cities.buildSearchUrl(cfg);
    return true;
  }

  async function init() {
    if (await maybeAutoNavigate()) return;
    build();
    await restoreLayout();
    render();
    B.scanner.startObserving();
    B.log("log", "panel injected, URL:", location.href);
    if ((await B.store.getRunState()) === "running") {
      setTimeout(function () { B.executor.step(); }, 1500);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
