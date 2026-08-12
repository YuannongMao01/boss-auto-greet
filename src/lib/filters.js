// Rule engine deciding whether a job matches the user config.
// Division of labour: the search term is handled by Boss (semantic matching), while this module
// narrows the results by topic keywords, blacklist, city and minimum salary.
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

  window.BAG.filters = { parseSalaryLowerK: parseSalaryLowerK, matches: matches };
})();
