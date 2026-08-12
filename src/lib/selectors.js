// ★★ P0 DOM 侦察产出集中地 ★★
// 以下选择器基于 Boss直聘 网页版常见结构的最佳猜测。首次使用请登录后在
// 搜索页控制台执行  window.BAG.dom.debugDumpCards()  验证，并按真实结构修正。
window.BAG = window.BAG || {};
(function () {
  const S = {
    // 搜索结果列表中的岗位卡片
    jobCard: "li.job-card-wrapper, .job-card-wrapper, .job-card-box",
    jobName: ".job-name, .job-title .name",
    salary: ".salary, .job-salary",
    company: ".company-name, .boss-name, .company-info .name",
    area: ".job-area, .job-area-wrapper, .company-location",
    tags: ".tag-list li, .job-tags span, .tag-list span",
    // 卡片上的岗位详情链接（用于提取 jobId）
    jobLink: "a.job-card-left, a.job-name, a[href*='job_detail'], a[ka]",
    // “立即沟通”按钮（详情抽屉 / 详情页 / 卡片悬浮）
    chatBtnSelector: ".op-btn-chat, .btn-startchat, .start-chat-btn, .btn-chat",
    chatBtnText: ["立即沟通", "继续沟通", "打招呼"],
    // 聊天页：消息输入框（textarea 或 contenteditable）
    chatInput: "#boss-chat-editor-input, .chat-input, textarea.input-area, .conversation-editor textarea, div.chat-input[contenteditable='true'], [contenteditable='true'].input-area",
    // 聊天页：发送按钮
    sendBtnSelector: ".submit, .btn-send, .send-message, .chat-op .btn-v2",
    sendBtnText: ["发送"],
    // 异常检测：验证码 / 风控页
    captcha: [".geetest_panel", ".geetest_holder", ".verify-wrap", ".nc-container", "[class*='captcha']"]
  };

  function extractJobId(card) {
    const link = card.querySelector(S.jobLink);
    if (link) {
      const href = link.getAttribute("href") || "";
      const m = href.match(/job_detail\/([^.?/]+)/);
      if (m) return m[1];
      const ka = link.getAttribute("ka");
      if (ka) return ka;
      if (href) return href;
    }
    const t = function (sel) { const n = card.querySelector(sel); return n ? n.textContent.trim() : ""; };
    return [t(S.jobName), t(S.company), t(S.salary)].join("|");
  }

  function text(el, sel) {
    const n = el.querySelector(sel);
    return n ? n.textContent.trim().replace(/\s+/g, " ") : "";
  }

  function parseCard(card) {
    const link = card.querySelector(S.jobLink);
    let url = link ? link.getAttribute("href") : "";
    if (url && url.charAt(0) === "/") url = "https://www.zhipin.com" + url;
    return {
      jobId: extractJobId(card),
      name: text(card, S.jobName),
      salary: text(card, S.salary),
      company: text(card, S.company),
      location: text(card, S.area),
      tags: Array.prototype.slice.call(card.querySelectorAll(S.tags)).map(function (t) { return t.textContent.trim(); }),
      url: url || "",
      _raw: (card.textContent || "").replace(/\s+/g, " ")
    };
  }

  function visible(el) { return el && el.offsetParent !== null; }

  function findByText(texts, root) {
    root = root || document;
    const nodes = root.querySelectorAll("a, button, span, div");
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (texts.indexOf((el.textContent || "").trim()) !== -1 && visible(el)) return el;
    }
    return null;
  }

  function findChatButton(root) {
    root = root || document;
    const btn = root.querySelector(S.chatBtnSelector);
    if (visible(btn)) return btn;
    return findByText(S.chatBtnText, root);
  }

  function findChatInput(root) {
    root = root || document;
    const el = root.querySelector(S.chatInput);
    return visible(el) ? el : null;
  }

  function findSendButton(root) {
    root = root || document;
    const btn = root.querySelector(S.sendBtnSelector);
    if (visible(btn)) return btn;
    return findByText(S.sendBtnText, root);
  }

  function detectCaptcha() {
    for (let i = 0; i < S.captcha.length; i++) {
      const el = document.querySelector(S.captcha[i]);
      if (visible(el)) return true;
    }
    return false;
  }

  function getAllCards() {
    return Array.prototype.slice.call(document.querySelectorAll(S.jobCard));
  }

  // 调试：打印卡片数量与首个卡片结构，用于 P0 侦察修正选择器
  function debugDumpCards() {
    const cards = getAllCards();
    console.log("[BAG] 卡片数量:", cards.length);
    if (cards[0]) {
      console.log("[BAG] 首个卡片 outerHTML:\n", cards[0].outerHTML);
      console.log("[BAG] 解析结果:", parseCard(cards[0]));
    } else {
      console.log("[BAG] 未匹配到卡片，请检查 jobCard 选择器");
    }
    return cards.length;
  }

  window.BAG.selectors = S;
  window.BAG.dom = {
    extractJobId: extractJobId, parseCard: parseCard,
    findChatButton: findChatButton, findChatInput: findChatInput, findSendButton: findSendButton,
    detectCaptcha: detectCaptcha, getAllCards: getAllCards, debugDumpCards: debugDumpCards
  };
})();
