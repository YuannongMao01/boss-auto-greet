// 注入侧边栏面板：一个主控键(开始/暂停) + 折叠的“更多”高级操作 + 队列。
(function () {
  const B = window.BAG;
  const BAG_VERSION = "v14";  // 每次改动我都会 +1，用于确认是否加载到新代码
  let root = null;

  function el(tag, cls, txt) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }
  function stateLabel(s) { return { idle: "空闲", running: "运行中", paused: "已暂停" }[s] || s; }
  function statusLabel(s) { return { pending: "待处理", greeted: "已招呼", skipped: "跳过", captcha: "验证码", error: "错误" }[s] || s; }

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

  async function render() {
    if (!root) return;
    const queue = await B.store.getQueue();
    const state = await B.store.getRunState();
    const dc = await B.store.getDailyCount();
    const config = await B.store.getConfig();

    const stat = root.querySelector(".bag-stat");
    const pending = queue.filter(function (q) { return q.status === "pending"; }).length;
    stat.textContent = "状态: " + stateLabel(state) + " · 今日 " + dc.count + "/" + config.dailyCap + " · 待处理 " + pending;

    const main = root.querySelector(".bag-main");
    if (state === "running") { main.textContent = "暂停"; main.classList.add("bag-running"); }
    else { main.textContent = "开始打招呼"; main.classList.remove("bag-running"); }

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

  // 主控：开始/暂停 切换。开始时若不在搜索页，自动先跳到配置的搜索页再跑。
  async function onMain() {
    const state = await B.store.getRunState();
    if (state === "running") { await B.executor.pause(); showMsg("已暂停（当前动作完成后停下）"); render(); return; }
    const cfg = await B.store.getConfig();
    if (!cfg.searchQuery) { showMsg("请先点扩展图标，在「搜索词」里填岗位关键词"); return; }
    if (!B.cities.isSearchPage()) {
      await B.store.setRunState("running");
      showMsg("正在打开搜索页并开始…");
      location.href = B.cities.buildSearchUrl(cfg); // 加载后由 init 自动接续 step()
      return;
    }
    await B.executor.run();
    showMsg("开始运行，按拟人节奏逐个打招呼…");
    render();
  }

  function build() {
    root = el("div", "bag-panel");

    const head = el("div", "bag-head");
    head.appendChild(el("span", "bag-title", "Boss 招呼助手 · " + BAG_VERSION));
    const toggle = el("span", "bag-toggle", "—");
    toggle.title = "折叠/展开";
    toggle.onclick = function () { root.classList.toggle("bag-collapsed"); };
    head.appendChild(toggle);
    root.appendChild(head);

    // 主控行
    const primary = el("div", "bag-primary");
    const main = el("button", "bag-main", "开始打招呼");
    main.onclick = onMain;
    const more = el("button", "bag-morebtn", "更多 ▾");
    more.onclick = function () {
      const box = root.querySelector(".bag-more");
      const open = box.style.display !== "none";
      box.style.display = open ? "none" : "flex";
      more.textContent = open ? "更多 ▾" : "收起 ▴";
    };
    primary.appendChild(main);
    primary.appendChild(more);
    root.appendChild(primary);

    // 状态行
    root.appendChild(el("div", "bag-stat"));

    // 折叠的“更多”高级操作
    const moreBox = el("div", "bag-more");
    moreBox.style.display = "none";
    const rescan = el("button", null, "扫描本页");
    rescan.onclick = async function () {
      const r = await B.scanner.scanOnce();
      if (r.total === 0) showMsg("本页 0 个卡片 ← 选择器需校准，点「调试」看结构");
      else {
        let m = "本页 " + r.total + " 个卡片：新增 " + r.added + " · 已在队列 " + r.inQueue +
                " · 已招呼过 " + r.greeted + " · 不符筛选 " + r.filtered;
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
      if (box0.style.display !== "none") { closeDebug(); return; } // 再点一次收起
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
      // 专项：全文搜“沟通/立即/打招呼/聊”类元素（放最前，不会被截断）
      const chatLike = Array.prototype.slice.call(document.querySelectorAll("a, button, span, div"))
        .filter(function (e) { const t = (e.textContent || "").trim(); return e.offsetParent !== null && t.length <= 8 && /沟通|立即|打招呼|聊/.test(t); })
        .map(desc);
      const chatText = "\n\n[★沟通类按钮]\n" + (chatLike.length ? Array.from(new Set(chatLike)).slice(0, 30).join("\n") : "(主页面未找到，可能在 iframe 里)");
      // iframe 列表
      const frames = Array.prototype.slice.call(document.querySelectorAll("iframe")).map(function (f) { return f.src || "(无src)"; });
      const frameText = "\n\n[iframe 数量 " + frames.length + "]\n" + frames.slice(0, 10).join("\n");
      // 一般可点击元素（排除超链接文本噪声）
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
    [rescan, clear, debug].forEach(function (b) { moreBox.appendChild(b); });
    root.appendChild(moreBox);

    const msg = el("div", "bag-msg");
    msg.style.display = "none";
    root.appendChild(msg);

    const dbgbox = el("div", "bag-debugbox");
    dbgbox.style.display = "none";
    root.appendChild(dbgbox);

    root.appendChild(el("div", "bag-list"));
    document.body.appendChild(root);
  }

  chrome.runtime.onMessage.addListener(function (msg) {
    if (["queue-updated", "state-updated", "progress"].indexOf(msg.type) !== -1) render();
  });

  // storage.onChanged 在同一内容脚本上下文也会触发，比 runtime 消息可靠
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
    B.log("log", "自动跳转到搜索页");
    location.href = B.cities.buildSearchUrl(cfg);
    return true;
  }

  async function init() {
    if (await maybeAutoNavigate()) return;
    build();
    render();
    B.scanner.startObserving();
    B.log("log", "面板已注入，URL:", location.href);
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
