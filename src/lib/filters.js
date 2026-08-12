// 规则引擎：判断一个岗位是否命中用户配置。
// 语义明确：搜索词交给 Boss（语义匹配），本地只做「必须包含」逐字过滤 + 屏蔽词 + 城市 + 薪资下限。
window.BAG = window.BAG || {};
(function () {
  // 解析薪资文本 -> 下限（单位 K）。取“第一个数字”及其单位。
  // 支持 "15-25K"(15) "20K·13薪"(20) "8千-1.2万"(8) "1-1.5万"(10) "面议"(null)。
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
    // 用整张卡片文本做匹配（标题/薪资/标签/公司/地点），比只看标题召回更全
    const hay = (job._raw || [job.name, job.company, (job.tags || []).join(" ")].join(" ")).toLowerCase();

    const must = config.mustInclude || [];
    for (let i = 0; i < must.length; i++) {
      if (hay.indexOf(String(must[i]).toLowerCase()) === -1) {
        return { ok: false, reason: "缺少必含词「" + must[i] + "」" };
      }
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
