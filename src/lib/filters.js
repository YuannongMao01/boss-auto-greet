// Rule engine deciding whether a job matches the user config.
// Division of labour: the search term is handled by Boss (semantic matching), while this module
// narrows the results by the job title, topic keywords, blacklist, company signals and city.
// Topic keywords are ANY-of, not all-of: a comma separated list of subjects is what a user means
// by "data or AI work", so requiring every entry to appear would reject essentially every job.
window.BAG = window.BAG || {};
(function () {
  // Curated signals for outsourcing, staffing and headhunter listings, which is what most
  // people mean by a low quality company. Kept in code so the user need not author the list.
  const AGENCY_WORDS = ["外包", "劳务", "派遣", "人力资源服务", "人事代理", "人才服务", "众包", "猎头", "驻场"];

  // A company that never uploaded a logo is served Boss's placeholder image, and that placeholder is
  // the same file on every such card. It is therefore identified by one image being shared across
  // several DIFFERENT companies, so no URL is hardcoded and a Boss redesign cannot silently break it.
  // One real company posting many jobs shares its logo too, which is why companies are counted, not cards.
  const PLACEHOLDER_MIN_COMPANIES = 3;

  function groupLogos(jobs) {
    const groups = {};
    (jobs || []).forEach(function (j) {
      const src = String((j && j.logo) || "").trim();
      if (!src) return;   // an unreadable logo is never counted, see isDefaultLogo
      const g = groups[src] || (groups[src] = { count: 0, companies: [] });
      g.count++;
      const co = String((j && j.company) || "").trim();
      if (co && g.companies.indexOf(co) === -1) g.companies.push(co);
    });
    return groups;
  }

  function detectPlaceholderLogos(jobs) {
    const groups = groupLogos(jobs);
    const out = {};
    Object.keys(groups).forEach(function (src) {
      if (groups[src].companies.length >= PLACEHOLDER_MIN_COMPANIES) out[src] = true;
    });
    return out;
  }

  // Obvious placeholder file names, a cheap second opinion when a page holds too few cards for
  // the sharing rule to fire.
  function looksLikeDefaultLogo(src) {
    const s = String(src || "").toLowerCase();
    if (!s) return false;
    return /default|nologo|no-logo|no_logo|blank|placeholder|empty/.test(s);
  }

  // Verdict for a single card. An empty src means the logo could not be read at all, which stays
  // lenient on purpose: a selector that stops matching must not silently reject every job on the page.
  function isDefaultLogo(src, placeholders) {
    const s = String(src || "").trim();
    if (!s) return false;
    if (looksLikeDefaultLogo(s)) return true;
    return !!(placeholders && placeholders[s]);
  }

  // Human readable grouping for the panel debug box, so the judgement can be checked by eye.
  function logoReport(jobs) {
    const groups = groupLogos(jobs);
    const keys = Object.keys(groups).sort(function (a, b) {
      return groups[b].companies.length - groups[a].companies.length;
    });
    if (!keys.length) return "(卡片上没读到 logo，选择器可能需要校准)";
    return keys.slice(0, 8).map(function (k) {
      const g = groups[k];
      const verdict = g.companies.length >= PLACEHOLDER_MIN_COMPANIES ? "判定=默认图" : "判定=真 logo";
      return g.companies.length + " 家公司 · " + g.count + " 张卡片 · " + verdict + " · " + k;
    }).join("\n");
  }

  function matches(job, config) {
    // Match against the whole card text (title, salary, tags, company, location) for better recall
    const hay = (job._raw || [job.name, job.company, (job.tags || []).join(" ")].join(" ")).toLowerCase();

    // Hard gate on the job title alone. Boss's own search is loose: a search for 实习生 returns
    // plenty of non-internship posts, so the title is checked separately from the card text.
    // Any-of, like the topic list, because 实习 / 见习 / intern are alternative spellings of one intent.
    const titleWords = config.titleIncludeAny || [];
    if (titleWords.length) {
      const title = String(job.name || "").toLowerCase();
      const hitTitle = titleWords.some(function (kw) { return title.indexOf(String(kw).toLowerCase()) !== -1; });
      if (!hitTitle) return { ok: false, reason: "标题里没有「" + titleWords.join("/") + "」" };
    }

    const topics = config.includeAny || [];
    if (topics.length) {
      const hit = topics.some(function (kw) { return hay.indexOf(String(kw).toLowerCase()) !== -1; });
      if (!hit) return { ok: false, reason: "未命中主题词「" + topics.join("/") + "」" };
    }

    const bad = (config.excludeKeywords || []).find(function (kw) { return hay.indexOf(String(kw).toLowerCase()) !== -1; });
    if (bad) return { ok: false, reason: "命中屏蔽词「" + bad + "」" };

    const badCo = (config.excludeCompanies || []).find(function (n) {
      return (job.company || "").toLowerCase().indexOf(String(n).toLowerCase()) !== -1;
    });
    if (badCo) return { ok: false, reason: "屏蔽公司「" + badCo + "」" };

    if (config.blockAgency) {
      const w = AGENCY_WORDS.find(function (x) { return hay.indexOf(x) !== -1; });
      if (w) return { ok: false, reason: "外包中介「" + w + "」" };
    }

    // logoIsDefault is decided by the scanner, which can compare every card on the page at once.
    if (config.requireCompanyLogo && job.logoIsDefault) {
      return { ok: false, reason: "公司没有 logo（Boss 默认图）" };
    }

    if (config.cities && config.cities.length) {
      const loc = (job.location || "").toLowerCase();
      const hit = config.cities.some(function (c) { return loc.indexOf(String(c).toLowerCase()) !== -1; });
      if (!hit) return { ok: false, reason: "城市不匹配" };
    }

    return { ok: true };
  }

  window.BAG.filters = {
    matches: matches, AGENCY_WORDS: AGENCY_WORDS,
    detectPlaceholderLogos: detectPlaceholderLogos, isDefaultLogo: isDefaultLogo,
    looksLikeDefaultLogo: looksLikeDefaultLogo, logoReport: logoReport,
    PLACEHOLDER_MIN_COMPANIES: PLACEHOLDER_MIN_COMPANIES
  };
})();
