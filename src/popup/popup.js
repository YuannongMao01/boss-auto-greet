// Popup settings logic: reads and writes the config object in chrome.storage.local.
const DEFAULT_CONFIG = {
  jobType: "fulltime", searchQuery: "", titleIncludeAny: [], includeAny: [], excludeKeywords: [], cities: [], greeting: "",
  excludeCompanies: [], blockAgency: false, requireCompanyLogo: false,
  dailyCap: 40, intervalSec: 20
};

function get(keys) { return new Promise(function (r) { chrome.storage.local.get(keys, r); }); }
function set(obj) { return new Promise(function (r) { chrome.storage.local.set(obj, r); }); }
function parseList(s) {
  return (s || "").split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean);
}
function fmtList(a) { return (a || []).join(", "); }

async function load() {
  const o = await get("config");
  const c = Object.assign({}, DEFAULT_CONFIG, o.config || {});
  document.getElementById("jobType").value = c.jobType || "fulltime";
  document.getElementById("searchQuery").value = c.searchQuery || "";
  document.getElementById("titleIncludeAny").value = fmtList(c.titleIncludeAny);
  document.getElementById("includeAny").value = fmtList(c.includeAny);
  document.getElementById("excludeKeywords").value = fmtList(c.excludeKeywords);
  document.getElementById("cities").value = fmtList(c.cities);
  document.getElementById("excludeCompanies").value = fmtList(c.excludeCompanies);
  document.getElementById("blockAgency").checked = !!c.blockAgency;
  document.getElementById("requireCompanyLogo").checked = !!c.requireCompanyLogo;
  document.getElementById("dailyCap").value = c.dailyCap;
  document.getElementById("intervalSec").value = c.intervalSec;
  document.getElementById("greeting").value = c.greeting || "";

  const today = new Date().toISOString().slice(0, 10);
  const dcObj = await get("dailyCount");
  const dc = dcObj.dailyCount;
  const count = dc && dc.date === today ? dc.count : 0;
  document.getElementById("todayStat").textContent = "今日已打招呼 " + count + " 个";

  const logsObj = await get("logs");
  const logs = (logsObj.logs || []).slice(-30).reverse();
  const box = document.getElementById("logs");
  box.innerHTML = "";
  logs.forEach(function (l) {
    const d = new Date(l.ts);
    const t = d.toTimeString().slice(0, 8);
    const div = document.createElement("div");
    div.textContent = t + " · " + (l.status || "") + (l.name ? " · " + l.name : "") + (l.reason ? " (" + l.reason + ")" : "");
    box.appendChild(div);
  });
}

async function save() {
  const gi = function (id) { return parseInt(document.getElementById(id).value, 10); };
  const config = {
    jobType: document.getElementById("jobType").value,
    searchQuery: document.getElementById("searchQuery").value.trim(),
    titleIncludeAny: parseList(document.getElementById("titleIncludeAny").value),
    includeAny: parseList(document.getElementById("includeAny").value),
    excludeKeywords: parseList(document.getElementById("excludeKeywords").value),
    cities: parseList(document.getElementById("cities").value),
    excludeCompanies: parseList(document.getElementById("excludeCompanies").value),
    blockAgency: document.getElementById("blockAgency").checked,
    requireCompanyLogo: document.getElementById("requireCompanyLogo").checked,
    dailyCap: Math.max(1, gi("dailyCap") || 40),
    intervalSec: Math.max(1, gi("intervalSec") || 20),
    greeting: document.getElementById("greeting").value.trim()
  };
  await set({ config: config });
  const msg = document.getElementById("msg");
  msg.textContent = "已保存 ✓";
  setTimeout(function () { msg.textContent = ""; }, 1800);
}

document.getElementById("save").addEventListener("click", save);
document.getElementById("resetCount").addEventListener("click", async function () {
  const today = new Date().toISOString().slice(0, 10);
  await set({ dailyCount: { date: today, count: 0 } });
  load();
});
document.addEventListener("DOMContentLoaded", load);
