// Rule engine deciding whether a job matches the user config.
// Division of labour: the search term is handled by Boss (semantic matching), while this module
// narrows the results by topic keywords, blacklist, company quality, city and minimum salary.
// Topic keywords are ANY-of, not all-of: a comma separated list of subjects is what a user means
// by "data or AI work", so requiring every entry to appear would reject essentially every job.
window.BAG = window.BAG || {};
(function () {
  // Parse a salary label into its lower bound in K, using the first number and its own unit.
  // Handles ranges, a K unit with a month-count suffix, mixed CJK units, and returns null when negotiable.
  function parseSalaryLowerK(salaryText) {
    if (!salaryText) return null;
    const t = salaryText.replace(/\s/g, "");
    const m = t.match(/[\d.]+/);
    if (!m) return null;
    const low = parseFloat(m[0]);
    let unit = t.charAt(m.index + m[0].length);
    if ("kK千万".indexOf(unit) === -1) {
      if (t.indexOf("万") !== -1) unit = "万";
      else if (t.indexOf("千") !== -1) unit = "千";
      else if (/[kK]/.test(t)) unit = "k";
      else return null;
    }
    if (unit === "万") return low * 10;
    return low;
  }


  // Company headcount labels Boss prints on a card: 0-20人, 20-99人, 100-499人, 500-999人,
  // 1000-9999人, 10000人以上. Returns the bucket lower bound, null when the card shows none.
  function parseCompanyScale(text) {
    const t = String(text || "").replace(/\s/g, "");
    let m = t.match(/(\d+)-(\d+)人/);
    if (m) return { min: parseInt(m[1], 10), text: m[0] };
    m = t.match(/(\d+)人以上/);
    if (m) return { min: parseInt(m[1], 10), text: m[0] };
    return { min: null, text: "" };
  }

  // Financing stages, ranked. 已上市 and 不需要融资 sit at the top: a listed or self funded
  // company carries no early stage risk. Longer labels come first so D轮及以上 is not read as D轮.
  const STAGES = [
    ["不需要融资", 7], ["已上市", 7], ["D轮及以上", 6], ["D轮", 6],
    ["C轮", 5], ["B轮", 4], ["A轮", 3], ["天使轮", 2], ["未融资", 1]
  ];
  function parseFinancingStage(text) {
    const t = String(text || "");
    for (let i = 0; i < STAGES.length; i++) {
      if (t.indexOf(STAGES[i][0]) !== -1) return { text: STAGES[i][0], rank: STAGES[i][1] };
    }
    return { text: "", rank: null };
  }

  // Curated signals for outsourcing, staffing and headhunter listings, which is what most
  // people mean by a low quality company. Kept in code so the user need not author the list.
  const AGENCY_WORDS = ["外包", "劳务", "派遣", "人力资源服务", "人事代理", "人才服务", "众包", "猎头", "驻场"];

  // Company facts read off the whole card text, so no extra selector has to stay in sync.
  function companyMeta(job) {
    const raw = job._raw || [job.company, (job.tags || []).join(" ")].join(" ");
    const scale = parseCompanyScale(raw);
    const stage = parseFinancingStage(raw);
    return { scaleMin: scale.min, scaleText: scale.text, stageRank: stage.rank, stageText: stage.text };
  }

  function matches(job, config) {
    // Match against the whole card text (title, salary, tags, company, location) for better recall
    const hay = (job._raw || [job.name, job.company, (job.tags || []).join(" ")].join(" ")).toLowerCase();

    const topics = config.includeAny || [];
    if (topics.length) {
      const hit = topics.some(function (kw) { return hay.indexOf(String(kw).toLowerCase()) !== -1; });
      if (!hit) return { ok: false, reason: "未命中主题词「" + topics.join("/") + "」" };
    }

    const bad = (config.excludeKeywords || []).find(function (kw) { return hay.indexOf(String(kw).toLowerCase()) !== -1; });
    if (bad) return { ok: false, reason: "命中屏蔽词「" + bad + "」" };

    // Company quality gates. A card that simply does not print its size or funding stage is kept
    // rather than rejected, the same lenient rule the salary check uses for a hidden salary.
    const meta = companyMeta(job);

    const badCo = (config.excludeCompanies || []).find(function (n) {
      return (job.company || "").toLowerCase().indexOf(String(n).toLowerCase()) !== -1;
    });
    if (badCo) return { ok: false, reason: "屏蔽公司「" + badCo + "」" };

    if (config.blockAgency) {
      const w = AGENCY_WORDS.find(function (x) { return hay.indexOf(x) !== -1; });
      if (w) return { ok: false, reason: "外包中介「" + w + "」" };
    }

    if (config.minCompanyScale && meta.scaleMin !== null && meta.scaleMin < config.minCompanyScale) {
      return { ok: false, reason: "公司规模偏小（" + meta.scaleText + "）" };
    }

    if (config.minFinancingRank && meta.stageRank !== null && meta.stageRank < config.minFinancingRank) {
      return { ok: false, reason: "融资阶段偏早（" + meta.stageText + "）" };
    }

    if (config.cities && config.cities.length) {
      const loc = (job.location || "").toLowerCase();
      const hit = config.cities.some(function (c) { return loc.indexOf(String(c).toLowerCase()) !== -1; });
      if (!hit) return { ok: false, reason: "城市不匹配" };
    }

    if (config.minSalary && config.minSalary > 0) {
      const low = parseSalaryLowerK(job.salary);
      if (low !== null && low < config.minSalary) return { ok: false, reason: "薪资低于下限" };
    }

    return { ok: true };
  }

  window.BAG.filters = {
    parseSalaryLowerK: parseSalaryLowerK, matches: matches,
    parseCompanyScale: parseCompanyScale, parseFinancingStage: parseFinancingStage,
    companyMeta: companyMeta, AGENCY_WORDS: AGENCY_WORDS
  };
})();
