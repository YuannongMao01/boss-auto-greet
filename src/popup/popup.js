// Popup settings logic: reads and writes the config object in chrome.storage.local.
const DEFAULT_CONFIG = {
  searchQuery: "", includeAny: [], excludeKeywords: [], cities: [], minSalary: 0, greeting: "", autoScan: false,
  excludeCompanies: [], minCompanyScale: 0, minFinancingRank: 0, blockAgency: false,
  dailyCap: 40, intervalMin: 8, intervalMax: 30
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
  document.getElementById("searchQuery").value = c.searchQuery || "";
  document.getElementById("includeAny").value = fmtList(c.includeAny);
  document.getElementById("excludeKeywords").value = fmtList(c.excludeKeywords);
  document.getElementById("cities").value = fmtList(c.cities);
  document.getElementById("excludeCompanies").value = fmtList(c.excludeCompanies);
  document.getElementById("minCompanyScale").value = String(c.minCompanyScale || 0);
  document.getElementById("minFinancingRank").value = String(c.minFinancingRank || 0);
  document.getElementById("blockAgency").checked = !!c.blockAgency;
  document.getElementById("minSalary").value = c.minSalary;
  document.getElementById("dailyCap").value = c.dailyCap;
  document.getElementById("intervalMin").value = c.intervalMin;
  document.getElementById("intervalMax").value = c.intervalMax;
  document.getElementById("greeting").value = c.greeting || "";
  document.getElementById("autoScan").checked = !!c.autoScan;

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
  let iMin = gi("intervalMin"), iMax = gi("intervalMax");
  if (isNaN(iMin) || iMin < 1) iMin = 1;
  if (isNaN(iMax) || iMax < iMin) iMax = iMin;
  const config = {
    searchQuery: document.getElementById("searchQuery").value.trim(),
    includeAny: parseList(document.getElementById("includeAny").value),
    excludeKeywords: parseList(document.getElementById("excludeKeywords").value),
    cities: parseList(document.getElementById("cities").value),
    excludeCompanies: parseList(document.getElementById("excludeCompanies").value),
    minCompanyScale: gi("minCompanyScale") || 0,
    minFinancingRank: gi("minFinancingRank") || 0,
    blockAgency: document.getElementById("blockAgency").checked,
    minSalary: Math.max(0, gi("minSalary") || 0),
    dailyCap: Math.max(1, gi("dailyCap") || 40),
    intervalMin: iMin,
    intervalMax: iMax,
    greeting: document.getElementById("greeting").value.trim(),
    autoScan: document.getElementById("autoScan").checked
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
