// Single place where every page selector lives, so a site redesign only needs edits here.
// To re-verify after a redesign, run window.BAG.dom.debugDumpCards() on a search page, or use
// the panel's debug button, which renders the same information inside the page.
window.BAG = window.BAG || {};
(function () {
  const S = {
    // Job cards in the search result list
    jobCard: "li.job-card-wrapper, .job-card-wrapper, .job-card-box",
    jobName: ".job-name, .job-title .name",
    salary: ".salary, .job-salary",
    company: ".company-name, .boss-name, .company-info .name",
    area: ".job-area, .job-area-wrapper, .company-location",
    tags: ".tag-list li, .job-tags span, .tag-list span",
    // Detail link on a card, used to derive the job id
    jobLink: "a.job-card-left, a.job-name, a[href*='job_detail'], a[ka]",
    // Contact button, present in the detail pane, the detail page and the card hover state
    chatBtnSelector: ".op-btn-chat, .btn-startchat, .start-chat-btn, .btn-chat",
    chatBtnText: ["立即沟通", "继续沟通", "打招呼"],
    // Chat page message box, either a textarea or a contenteditable element
    chatInput: "#boss-chat-editor-input, .chat-input, textarea.input-area, .conversation-editor textarea, div.chat-input[contenteditable='true'], [contenteditable='true'].input-area",
    // Chat page send button
    sendBtnSelector: ".submit, .btn-send, .send-message, .chat-op .btn-v2",
    sendBtnText: ["发送"],
    // Anomaly detection: captcha and rate limit interstitials
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

  // Debug helper: dump the card count and the first card's structure to recalibrate selectors
  function debugDumpCards() {
    const cards = getAllCards();
    console.log("[BAG] card count:", cards.length);
    if (cards[0]) {
      console.log("[BAG] first card outerHTML:\n", cards[0].outerHTML);
      console.log("[BAG] parsed:", parseCard(cards[0]));
    } else {
      console.log("[BAG] no card matched, check the jobCard selector");
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
