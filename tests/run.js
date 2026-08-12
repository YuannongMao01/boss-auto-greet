// Regression tests: node tests/run.js
const fs=require("fs"), vm=require("vm");
const D=__dirname+"/../";
let pass=0, fail=0;
function ok(name,cond,extra){ if(cond){pass++;console.log("  PASS  "+name);} else {fail++;console.log("  FAIL  "+name+(extra!==undefined?"  got="+JSON.stringify(extra):""));} }
function eq(name,a,b){ ok(name, JSON.stringify(a)===JSON.stringify(b), a); }

// ---- fake chrome.storage.local ----
let DB={};
const chrome={
  storage:{ local:{
    get:function(keys,cb){ const out={}; const ks = typeof keys==="string"?[keys]:(Array.isArray(keys)?keys:Object.keys(keys||{}));
      ks.forEach(function(k){ if(k in DB) out[k]=DB[k]; }); cb(out); },
    set:function(o,cb){ Object.assign(DB,o); cb&&cb(); },
    remove:function(k,cb){ (Array.isArray(k)?k:[k]).forEach(function(x){delete DB[x];}); cb&&cb(); }
  }},
  runtime:{ sendMessage:function(){}, lastError:null },
  notifications:{ create:function(){} },
  alarms:{ create:function(){}, onAlarm:{addListener:function(){}} }
};
const ctx = vm.createContext({ window:{}, chrome:chrome, console:console, setTimeout:setTimeout, clearTimeout:clearTimeout, Date:Date, Math:Math, JSON:JSON, Set:Set, Object:Object, Array:Array, String:String, Number:Number, parseFloat:parseFloat, parseInt:parseInt, isNaN:isNaN, MutationObserver:function(){this.observe=function(){};this.disconnect=function(){};}, location:{href:"https://www.zhipin.com/web/geek/jobs?query=x"}, document:{body:{}} });
function load(f){ vm.runInContext(fs.readFileSync(D+f,"utf8"), ctx, {filename:f}); }
["src/lib/logger.js","src/lib/humanize.js","src/lib/store.js","src/lib/selectors.js","src/lib/cities.js","src/lib/filters.js"].forEach(load);
const B = ctx.window.BAG;

console.log("\n[1] filters.matches with topic keywords / exclude / city");
const F=B.filters;
const job={ name:"SLAM算法实习生", company:"某某科技", tags:["在校/应届","本科"], location:"上海·浦东新区", salary:"200-300元/天" };
job._raw=[job.name,job.company,job.tags.join(" "),job.location,job.salary].join(" ");
eq("no topic keywords -> ok", F.matches(job,{includeAny:[]}), {ok:true});
eq("single topic keyword hit -> ok", F.matches(job,{includeAny:["算法"]}), {ok:true});
eq("ANY-of: one hit is enough even when the others are absent",
   F.matches(job,{includeAny:["数据","AI","Agent","算法"]}), {ok:true});
const r1=F.matches(job,{includeAny:["Python","Golang"]});
ok("no topic keyword hits -> rejected, reason lists them all",
   r1.ok===false && r1.reason.indexOf("Python")>=0 && r1.reason.indexOf("Golang")>=0, r1);
const cardOnly={ name:"SLAM算法", company:"某某科技", tags:["1-3年","本科"], location:"上海" };
cardOnly._raw=[cardOnly.name,cardOnly.company,cardOnly.tags.join(" "),cardOnly.location].join(" ");
const r2=F.matches(cardOnly,{includeAny:["实习"]});
ok("term absent from card text -> rejected with a reason naming it",
   r2.ok===false && r2.reason==="未命中主题词「实习」", r2);

// The exact configuration that filtered out all 300 cards: three unrelated topics.
// Under the old all-of rule nothing could ever match; any-of is what the user meant.
const userTopics = { searchQuery:"实习", includeAny:["数据","AI","Agent"], cities:["上海"] };
function mk(name){ const c={name:name,company:"某科技",salary:"200-300元/天",location:"上海·浦东新区",tags:["在校/应届"]};
  c._raw=[c.name,c.company,c.tags.join(" "),c.location,c.salary].join(" "); return c; }
ok("REGRESSION 数据/AI/Agent: a data job is kept", F.matches(mk("数据分析实习生"), userTopics).ok===true);
ok("REGRESSION 数据/AI/Agent: an AI job is kept", F.matches(mk("AI算法实习生"), userTopics).ok===true);
ok("REGRESSION 数据/AI/Agent: an Agent job is kept", F.matches(mk("大模型Agent开发实习"), userTopics).ok===true);
const off = F.matches(mk("前端开发实习生"), userTopics);
ok("REGRESSION 数据/AI/Agent: an unrelated job is still rejected", off.ok===false, off);
ok("REGRESSION 数据/AI/Agent: rejection reason names every topic",
   off.reason==="未命中主题词「数据/AI/Agent」", off.reason);
const r3=F.matches(cardOnly,{excludeKeywords:["外包","SLAM"]});
ok("exclude hit", r3.ok===false && r3.reason.indexOf("SLAM")>=0, r3);
const r4=F.matches(cardOnly,{cities:["杭州"]});
ok("city mismatch", r4.ok===false && r4.reason==="城市不匹配", r4);
eq("city match", F.matches(cardOnly,{cities:["上海"]}), {ok:true});
console.log("\n[3] cities.buildSearchUrl uses searchQuery");
const u=B.cities.buildSearchUrl({searchQuery:"算法实习", cities:["上海"]});
ok("url is /web/geek/jobs with query+city", u.indexOf("/web/geek/jobs?")>0 && u.indexOf("query=")>0 && u.indexOf("101020100")>0, u);
ok("query is url-encoded searchQuery", u.indexOf(encodeURIComponent("算法实习"))>0, u);
const u2=B.cities.buildSearchUrl({searchQuery:"算法", cities:["火星"]});
ok("unknown city -> no city param crash", typeof u2==="string" && u2.indexOf("query=")>0, u2);

console.log("\n[4] cities.isSearchPage");
// isSearchPage() reads the page location, it takes no argument
ctx.URLSearchParams = URLSearchParams;
function at(pathname, search){ ctx.location = { pathname: pathname, search: search, href: "https://www.zhipin.com"+pathname+search }; }
at("/web/geek/jobs","?query=%E7%AE%97%E6%B3%95&city=101020100");
ok("jobs?query -> true",  B.cities.isSearchPage()===true);
at("/web/geek/jobs","");
ok("jobs (no query) -> false", B.cities.isSearchPage()===false);
at("/web/geek/job","?query=a");
ok("legacy /web/geek/job -> true", B.cities.isSearchPage()===true);
at("/web/geek/recommend","");
ok("recommend page -> false", B.cities.isSearchPage()===false);
at("/web/geek/chat","");
ok("chat page -> false", B.cities.isSearchPage()===false);

console.log("\n[4b] cities.searchMatchesAt decides whether the page shows the configured search");
const SM = B.cities.searchMatchesAt;
const cfgA = { searchQuery: "算法实习", cities: ["上海"] };
ok("exact query + city -> match",
   SM(cfgA, "/web/geek/jobs", "?query=" + encodeURIComponent("算法实习") + "&city=101020100") === true);
ok("THE REPORTED BUG: stale query on a real search page -> no match",
   SM(cfgA, "/web/geek/jobs", "?query=" + encodeURIComponent("算法") + "&city=101020100") === false);
ok("wrong city -> no match",
   SM(cfgA, "/web/geek/jobs", "?query=" + encodeURIComponent("算法实习") + "&city=101280600") === false);
ok("recommendation feed -> no match", SM(cfgA, "/web/geek/jobs", "") === false);
ok("chat page -> no match", SM(cfgA, "/web/geek/chat", "") === false);
ok("extra site filters are preserved, still a match",
   SM(cfgA, "/web/geek/jobs", "?query=" + encodeURIComponent("算法实习") + "&city=101020100&degree=203&experience=101") === true);
ok("no city configured -> city param ignored",
   SM({ searchQuery: "算法实习", cities: [] }, "/web/geek/jobs", "?query=" + encodeURIComponent("算法实习") + "&city=101280600") === true);
ok("empty search term never matches a real query",
   SM({ searchQuery: "", cities: [] }, "/web/geek/jobs", "?query=" + encodeURIComponent("算法")) === false);

console.log("\n[5] store.getConfig legacy migration (keywords / mustInclude -> searchQuery + includeAny)");
(async function(){
  DB={ config:{ keywords:["算法","实习"], matchMode:"and", cities:["上海"], greeting:"hi" } };
  let c=await B.store.getConfig();
  eq("keywords[0] -> searchQuery", c.searchQuery, "算法");
  eq("keywords[1:] -> includeAny", c.includeAny, ["实习"]);
  eq("other fields kept", c.cities, ["上海"]);

  DB={ config:{ keywords:["算法实习"] } };
  c=await B.store.getConfig();
  eq("single keyword -> searchQuery only", [c.searchQuery,c.includeAny], ["算法实习",[]]);

  DB={ config:{ searchQuery:"算法实习", includeAny:[] } };
  c=await B.store.getConfig();
  eq("new config untouched", [c.searchQuery,c.includeAny], ["算法实习",[]]);

  // the previous all-of field is carried over as the any-of list
  DB={ config:{ searchQuery:"实习", mustInclude:["数据","AI","Agent"] } };
  c=await B.store.getConfig();
  eq("mustInclude migrates to includeAny", c.includeAny, ["数据","AI","Agent"]);
  DB={ config:{ searchQuery:"实习", intervalMin:8, intervalMax:30 } };
  c=await B.store.getConfig();
  eq("an old interval range collapses to its midpoint", c.intervalSec, 19);
  DB={ config:{ searchQuery:"实习", intervalSec:12, intervalMin:8, intervalMax:30 } };
  c=await B.store.getConfig();
  eq("an explicit intervalSec wins over the legacy range", c.intervalSec, 12);

  DB={ config:{ searchQuery:"实习", mustInclude:["数据"], includeAny:["AI"] } };
  c=await B.store.getConfig();
  eq("an existing includeAny wins over the legacy field", c.includeAny, ["AI"]);
  ok("defaults present", c.dailyCap>0 && typeof c.intervalSec==="number", {cap:c.dailyCap});

  DB={};
  c=await B.store.getConfig();
  eq("fresh install defaults", [c.searchQuery,c.includeAny,c.excludeKeywords], ["",[],[]]);

  console.log("\n[6] greetedJobs migration from dirty seenJobs (regression)");
  DB={ seenJobs:["A","B","C"], logs:[{status:"greeted",jobId:"A",name:"a"},{status:"skipped",jobId:"B"}] };
  let g=await B.store.getGreeted();
  eq("rebuilt from logs greeted only", [...g], ["A"]);
  ok("legacy seenJobs deleted", !("seenJobs" in DB), Object.keys(DB));
  await B.store.addGreeted(["B"]);
  g=await B.store.getGreeted();
  ok("B now permanently greeted", g.has("A")&&g.has("B"), [...g]);

  console.log("\n[7] scanner reason tally (the new panel hint)");
  // stub dom + reload scanner into the same ctx
  const cards=[
    {name:"SLAM算法",       tags:["1-3年","本科"], location:"上海", jobId:"j1"},
    {name:"感知算法",       tags:["3-5年","硕士"], location:"上海", jobId:"j2"},
    {name:"算法工程师",     tags:["在校/应届"],    location:"上海", jobId:"j3"},
    {name:"销售代表",       tags:["不限"],         location:"上海", jobId:"j4"}
  ].map(function(c){ c.company="X公司"; c.salary="20-30K"; c.url="/job_detail/"+c.jobId+".html";
                     c._raw=[c.name,c.company,c.tags.join(" "),c.location,c.salary].join(" "); return c; });
  ctx.window.BAG.dom = { getAllCards:function(){ return cards; }, parseCard:function(c){ return c; } };
  vm.runInContext(fs.readFileSync(D+"src/content/scanner.js","utf8"), ctx, {filename:"scanner.js"});

  DB={ config:{ searchQuery:"算法", includeAny:["实习"], cities:["上海"] } };
  let r=await ctx.window.BAG.scanner.scanOnce();
  eq("all filtered", [r.total,r.added,r.filtered], [4,0,4]);
  eq("topReason names the culprit", r.topReason, "未命中主题词「实习」");
  eq("topCount", r.topCount, 4);

  DB={ config:{ searchQuery:"算法", includeAny:[], excludeKeywords:["销售"], cities:["上海"] } };
  r=await ctx.window.BAG.scanner.scanOnce();
  eq("3 added, 1 excluded", [r.added,r.filtered], [3,1]);
  eq("reason = exclude", r.topReason, "命中屏蔽词「销售」");
  eq("queue got 3", (DB.queue||[]).length, 3);

  r=await ctx.window.BAG.scanner.scanOnce();
  eq("re-scan: nothing new, 3 already in queue", [r.added,r.inQueue], [0,3]);

  DB.queue=[]; DB.greetedJobs=["j1"];
  r=await ctx.window.BAG.scanner.scanOnce();
  eq("after clearing queue: greeted j1 stays out, 2 re-added", [r.added,r.greeted,r.filtered], [2,1,1]);

  console.log("\n[7b] unavailable marking is reversible when the feed reshuffles");
  vm.runInContext(fs.readFileSync(D+"src/content/executor.js","utf8"), ctx, {filename:"executor.js"});
  const EX = ctx.window.BAG.executor;

  // three pending + one greeted; the executor writes off what the feed no longer shows
  DB = { config:{ searchQuery:"算法", includeAny:[], cities:["上海"] },
         queue:[{jobId:"j1",name:"a",status:"pending",approved:true},
                {jobId:"j2",name:"b",status:"pending",approved:true},
                {jobId:"j3",name:"c",status:"pending",approved:false},
                {jobId:"j4",name:"d",status:"greeted",approved:true}] };
  let marked = await EX.markUnavailable();
  eq("only approved+pending rows are written off", marked, 2);
  eq("statuses after write-off",
     DB.queue.map(function(x){return x.jobId+":"+x.status;}),
     ["j1:unavailable","j2:unavailable","j3:pending","j4:greeted"]);

  // the same job shows up on a later load -> scanner puts it back in play
  r = await ctx.window.BAG.scanner.scanOnce();   // cards j1..j4 exist in the stub
  const back = DB.queue.filter(function(x){ return x.jobId==="j1"; })[0];
  eq("reappearing job is revived to pending", back.status, "pending");
  eq("revived jobs are re-approved", back.approved, true);
  ok("scan reports how many it revived", r.revived >= 1, r.revived);
  ok("revived jobs are not double counted as new", r.added === 0, r.added);

  // a job still absent from the feed stays written off
  DB.queue.push({jobId:"gone1",name:"gone",status:"unavailable",approved:true});
  await ctx.window.BAG.scanner.scanOnce();
  eq("job absent from the feed stays unavailable",
     DB.queue.filter(function(x){return x.jobId==="gone1";})[0].status, "unavailable");

  // a revived job must still satisfy the filter
  DB.queue.forEach(function(x){ if(x.jobId==="j2"){ x.status="unavailable"; } });
  DB.config = { searchQuery:"算法", includeAny:["不可能出现的词"], cities:["上海"] };
  await ctx.window.BAG.scanner.scanOnce();
  eq("a job the filter now rejects is not revived",
     DB.queue.filter(function(x){return x.jobId==="j2";})[0].status, "unavailable");

  console.log("\n[8] no legacy field references anywhere");
  ["src/content/panel.js","src/content/executor.js","src/popup/popup.js","src/popup/popup.html","src/lib/filters.js","src/lib/cities.js"].forEach(function(f){
    const t=fs.readFileSync(D+f,"utf8");
    ok(f+" clean of cfg.keywords/matchMode", !/cfg\.keywords|config\.keywords|matchMode|id="keywords"/.test(t));
  });
  const pan=fs.readFileSync(D+"src/content/panel.js","utf8");
  ok("panel version is v1", /BAG_VERSION = "v1"/.test(pan));
  ok("panel shows top reason", pan.indexOf("主要原因")>0);

  console.log("\n[9] removed settings stay removed, popup ids stay in sync");
  const cfgKeys = Object.keys(B.store.DEFAULT_CONFIG);
  ok("DEFAULT_CONFIG has no work-hours fields",
     cfgKeys.indexOf("workStart")===-1 && cfgKeys.indexOf("workEnd")===-1, cfgKeys);
  ok("DEFAULT_CONFIG has no dead todayOnly field", cfgKeys.indexOf("todayOnly")===-1, cfgKeys);
  ["src/content/executor.js","src/popup/popup.js","src/popup/popup.html","src/lib/store.js"].forEach(function(f){
    ok(f+" free of work-hours references",
       !/workStart|workEnd|inWorkHours|todayOnly/.test(fs.readFileSync(D+f,"utf8")));
  });
  const ph=fs.readFileSync(D+"src/popup/popup.html","utf8");
  const pjs=fs.readFileSync(D+"src/popup/popup.js","utf8");
  const ids=[...pjs.matchAll(/getElementById\("([^"]+)"\)/g)].map(function(m){return m[1];});
  const missing=[...new Set(ids)].filter(function(id){ return ph.indexOf('id="'+id+'"')===-1; });
  ok("every id popup.js touches exists in popup.html", missing.length===0, missing);
  const NAME="Boss Auto Greet";
  [["manifest.json",/"name":\s*"([^"]+)"/],["src/popup/popup.html",/<h1>([^<]+)<\/h1>/]].forEach(function(pair){
    const t=fs.readFileSync(D+pair[0],"utf8"), m=t.match(pair[1]);
    ok(pair[0]+" carries the product name", !!m && m[1].indexOf(NAME)===0, m?m[1]:null);
  });
  ["src/content/panel.js","src/background.js","src/popup/popup.html","manifest.json"].forEach(function(f){
    ok(f+" free of the old product name", fs.readFileSync(D+f,"utf8").indexOf("Boss 招呼助手")===-1);
  });

  console.log("\n[9] company blacklist and the agency filter");
  function co(name, extra){
    const c={ name:"数据分析实习生", company:name, salary:"200-300元/天", location:"上海·浦东新区", tags:["在校/应届"] };
    c._raw=[c.name,c.company,c.tags.join(" "),c.location,c.salary,extra||""].join(" ");
    return c;
  }
  const big=co("大厂科技","互联网 已上市 10000人以上");
  const tiny=co("小小信息","互联网 未融资 0-20人");
  const blank=co("某某科技","");

  ok("no company rules -> everything passes", F.matches(tiny,{}).ok===true);
  const rc=F.matches(co("某某人力资源","互联网 已上市 10000人以上"),{excludeCompanies:["某某人力"]});
  ok("company blacklist rejects by name and reports it",
     rc.ok===false && rc.reason.indexOf("某某人力")>=0, rc);
  ok("company blacklist leaves other companies alone",
     F.matches(big,{excludeCompanies:["某某人力"]}).ok===true);
  const mention=co("大厂科技","互联网 已上市 10000人以上 合作方某某人力");
  ok("company blacklist matches the company name only, not the rest of the card",
     F.matches(mention,{excludeCompanies:["某某人力"]}).ok===true);

  ["外包","劳务","派遣","猎头","驻场"].forEach(function(w){
    const r=F.matches(co("某某科技", w+" 已上市 10000人以上"),{blockAgency:true});
    ok("agency filter rejects a "+w+" listing", r.ok===false && r.reason.indexOf(w)>=0, r);
  });
  ok("agency filter leaves a normal listing alone", F.matches(big,{blockAgency:true}).ok===true);
  ok("agency filter is off by default", F.matches(co("某某科技","外包 已上市"),{}).ok===true);

  console.log("\n[9b] company fields are wired through config and the popup");
  ["excludeCompanies","blockAgency"].forEach(function(k){
    ok("DEFAULT_CONFIG declares "+k, k in B.store.DEFAULT_CONFIG);
  });
  const coPopupJs=fs.readFileSync(D+"src/popup/popup.js","utf8");
  const coPopupHtml=fs.readFileSync(D+"src/popup/popup.html","utf8");
  ["excludeCompanies","blockAgency"].forEach(function(k){
    ok("popup.js saves "+k, coPopupJs.indexOf(k)>=0);
    ok("popup.html has a control for "+k, coPopupHtml.indexOf('id="'+k+'"')>=0);
  });
  console.log("\n[10] placeholder company logo detection");
  function lj(company, logo){ return { company: company, logo: logo, name: "job", _raw: company }; }
  const REAL="https://img.bosszhipin.com/beijin/upload/com/real-a.png";
  const REAL2="https://img.bosszhipin.com/beijin/upload/com/real-b.png";
  const PH="https://img.bosszhipin.com/beijin/static/company-default.png";

  // one real company posting many jobs shares its own logo, which must not look like a placeholder
  const oneCompanyManyJobs=[lj("大厂科技",REAL),lj("大厂科技",REAL),lj("大厂科技",REAL),
                            lj("大厂科技",REAL),lj("大厂科技",REAL)];
  eq("a single company reusing its logo is not a placeholder",
     F.detectPlaceholderLogos(oneCompanyManyJobs)[REAL], undefined);

  const shared=[lj("甲科技",PH),lj("乙信息",PH),lj("丙网络",PH),lj("大厂科技",REAL),lj("另一家",REAL2)];
  ok("one image shared by three different companies is the placeholder",
     F.detectPlaceholderLogos(shared)[PH]===true);
  ok("a logo used by a single company is left alone",
     F.detectPlaceholderLogos(shared)[REAL]===undefined);
  eq("two companies sharing is still below the threshold",
     F.detectPlaceholderLogos([lj("甲",PH),lj("乙",PH)])[PH], undefined);
  eq("threshold is stated in code, not magic", F.PLACEHOLDER_MIN_COMPANIES, 3);

  ok("obvious placeholder file names are recognised on their own",
     F.looksLikeDefaultLogo("/static/img/company-default.png")===true &&
     F.looksLikeDefaultLogo("/img/nologo.png")===true &&
     F.looksLikeDefaultLogo("/x/placeholder.jpg")===true);
  ok("a normal logo url is not flagged by name", F.looksLikeDefaultLogo(REAL)===false);
  ok("an empty src is never flagged by name", F.looksLikeDefaultLogo("")===false);

  const phSet=F.detectPlaceholderLogos(shared);
  ok("verdict: shared image -> default", F.isDefaultLogo(PH,phSet)===true);
  ok("verdict: own image -> real", F.isDefaultLogo(REAL,phSet)===false);
  ok("verdict: unreadable src stays lenient", F.isDefaultLogo("",phSet)===false);

  console.log("\n[10b] the logo rule must never be able to reject a whole page");
  // If the logo selector ever stops matching, every src is empty. That must not wipe the feed out,
  // the same lenient rule used for a hidden salary or an unstated company size.
  const blindPage=[]; for (let i=0;i<20;i++) blindPage.push(lj("公司"+i,""));
  const blindPh=F.detectPlaceholderLogos(blindPage);
  eq("an all-empty page yields no placeholders", Object.keys(blindPh).length, 0);
  let survived=0;
  blindPage.forEach(function(j){
    j.logoIsDefault=F.isDefaultLogo(j.logo,blindPh);
    if (F.matches(j,{requireCompanyLogo:true}).ok) survived++;
  });
  eq("REGRESSION selector miss keeps every job instead of filtering all 20", survived, 20);

  console.log("\n[10c] matches honours requireCompanyLogo");
  function logoJob(isDefault){
    const c={ name:"数据分析实习生", company:"某某科技", salary:"200-300元/天",
              location:"上海·浦东新区", tags:["在校/应届"], logoIsDefault:isDefault };
    c._raw=[c.name,c.company,c.tags.join(" "),c.location,c.salary].join(" ");
    return c;
  }
  const rl=F.matches(logoJob(true),{requireCompanyLogo:true});
  ok("a default-logo company is rejected with a readable reason",
     rl.ok===false && rl.reason.indexOf("logo")>=0, rl);
  ok("a company with its own logo passes", F.matches(logoJob(false),{requireCompanyLogo:true}).ok===true);
  ok("the rule is off by default", F.matches(logoJob(true),{}).ok===true);

  const rep=F.logoReport(shared);
  ok("logo report marks the shared image as the default one",
     rep.indexOf("判定=默认图")>=0 && rep.indexOf(PH)>=0, rep);
  ok("logo report marks a private logo as real", rep.indexOf("判定=真 logo")>=0, rep);
  eq("logo report says so when nothing could be read",
     F.logoReport([lj("a",""),lj("b","")]).indexOf("没读到 logo")>=0, true);

  console.log("\n[10d] logo fields are wired through config, popup, scanner and panel");
  ok("DEFAULT_CONFIG declares requireCompanyLogo", "requireCompanyLogo" in B.store.DEFAULT_CONFIG);
  const lgPopupJs=fs.readFileSync(D+"src/popup/popup.js","utf8");
  const lgPopupHtml=fs.readFileSync(D+"src/popup/popup.html","utf8");
  ok("popup.js saves requireCompanyLogo", lgPopupJs.indexOf("requireCompanyLogo")>=0);
  ok("popup.html has a control for it", lgPopupHtml.indexOf('id="requireCompanyLogo"')>=0);
  const lgScanner=fs.readFileSync(D+"src/content/scanner.js","utf8");
  ok("scanner parses the page before filtering so logos can be compared",
     lgScanner.indexOf("detectPlaceholderLogos")>=0 && lgScanner.indexOf("logoIsDefault")>=0);
  const lgPanel=fs.readFileSync(D+"src/content/panel.js","utf8");
  ok("panel debug box reports the logo grouping", lgPanel.indexOf("logoReport")>=0);
  // B.dom is replaced by a stub earlier in this file for the scanner tests, so the export is
  // checked at the source level, the same way the other wiring assertions here are.
  const lgSel=fs.readFileSync(D+"src/lib/selectors.js","utf8");
  ok("dom layer exposes logoSrc", /logoSrc:\s*logoSrc/.test(lgSel));
  ok("logo selectors are tried one at a time, not as one selector list",
     /companyLogo:\s*\[/.test(lgSel));
  ok("parseCard carries the logo url", /logo:\s*logoSrc\(card\)/.test(lgSel));

  console.log("\n[11] one activity interval, jittered, replaces the old min/max pair");
  (function(){
    const H=B.humanize;
    let lo=Infinity, hi=-Infinity;
    for (let i=0;i<400;i++){ const v=H.jitter(20000,0.3); if(v<lo)lo=v; if(v>hi)hi=v; }
    ok("jitter stays inside 30% of the configured gap", lo>=14000 && hi<=26000, {lo:lo,hi:hi});
    ok("jitter is not a constant, so the rhythm never becomes periodic", hi-lo>1000, {span:hi-lo});
    ok("the range helper went away with the min/max pair", H.delayMs===undefined);
  })();
  const exSrc=fs.readFileSync(D+"src/content/executor.js","utf8");
  ok("executor waits on the single configured gap", /jitter\(cfg\.intervalSec \* 1000/.test(exSrc));

  console.log("\n[11b] removed settings must not creep back");
  ["minSalary","minCompanyScale","minFinancingRank","intervalMin","intervalMax","workStart","workEnd","todayOnly","autoScan"]
    .forEach(function(k){ ok("DEFAULT_CONFIG free of "+k, !(k in B.store.DEFAULT_CONFIG)); });
  ["src/lib/filters.js","src/popup/popup.js","src/popup/popup.html","src/content/executor.js","src/content/panel.js","src/content/scanner.js"]
    .forEach(function(f){
      const t=fs.readFileSync(D+f,"utf8");
      ["minSalary","minCompanyScale","minFinancingRank","intervalMin","intervalMax","parseSalaryLowerK","companyMeta","autoScan"]
        .forEach(function(k){ ok(f+" free of "+k, t.indexOf(k)===-1); });
    });
  ok("nothing navigates the browser on its own any more",
     fs.readFileSync(D+"src/content/panel.js","utf8").indexOf("maybeAutoNavigate")===-1);
  ok("store.js keeps the old interval names only inside the migration",
     (function(){ const t=fs.readFileSync(D+"src/lib/store.js","utf8");
       const i=t.indexOf("intervalMin");
       return i>=0 && t.slice(0,i).indexOf("The gap used to be a min and max pair")>=0; })());
  ok("popup.html still carries the single interval input",
     fs.readFileSync(D+"src/popup/popup.html","utf8").indexOf('id="intervalSec"')>=0);
  ok("the agency toggle sits directly under the blacklist field",
     (function(){ const t=fs.readFileSync(D+"src/popup/popup.html","utf8");
       return t.indexOf('id="blockAgency"') > t.indexOf('id="excludeKeywords"') &&
              t.indexOf('id="blockAgency"') < t.indexOf('id="cities"'); })());

  console.log("\n[12] popup typography: a field title is a heading, its note is not");
  (function(){
    const css=fs.readFileSync(D+"src/popup/popup.css","utf8");
    const html=fs.readFileSync(D+"src/popup/popup.html","utf8");
    ok("field titles are bold", /\.field label \{[^}]*font-weight: 600/.test(css));
    ok("checkbox titles are bold too", /\.check label \{[^}]*font-weight: 600/.test(css));
    ok("notes are explicitly normal weight", /\.tip \{[^}]*font-weight: 400/.test(css));
    ok("bold inside a note is neutralised", /\.tip b[^{]*\{[^}]*font-weight: 400/.test(css));
    ok("no note carries bold markup", html.indexOf("<b>")===-1);
    // An explanation in brackets would be bolded along with the title, so it belongs in the note
    const labels=(html.match(/<label>[\s\S]*?<\/label>/g)||[]).map(function(t){
      return t.replace(/<[^>]+>/g,"").trim();
    });
    ok("every field has a title", labels.length>=8, labels.length);
    // A unit such as 活动间隔（秒）is part of the title. Anything longer is an explanation.
    const withBrackets=labels.filter(function(t){
      const m=t.match(/[（(]([^）)]*)[）)]/);
      return !!m && m[1].length>3;
    });
    ok("no title carries a bracketed explanation", withBrackets.length===0, withBrackets);
    const longTitles=labels.filter(function(t){ return t.length>18; });
    ok("titles stay short enough to read as headings", longTitles.length===0, longTitles);
  })();

  console.log("\n[13] hard title gate, independent of the card text");
  (function(){
    function tj(title, cardExtra){
      const c={ name:title, company:"某科技", salary:"200-300元/天",
                location:"上海·浦东新区", tags:["在校/应届"] };
      c._raw=[c.name,c.company,c.tags.join(" "),c.location,c.salary,cardExtra||""].join(" ");
      return c;
    }
    const gate={ titleIncludeAny:["实习"] };
    ok("a title carrying the word passes", F.matches(tj("数据分析实习"), gate).ok===true);
    ok("another spelling in the title passes", F.matches(tj("实习-算法工程师"), gate).ok===true);
    const miss=F.matches(tj("数据分析师"), gate);
    ok("a title without the word is rejected and the reason names it",
       miss.ok===false && miss.reason.indexOf("实习")>=0, miss);

    // THE REPORTED PROBLEM: Boss returns non-internship posts for 实习生. Those cards still mention
    // 实习 elsewhere (tags, company blurb), so the gate has to read the title and nothing else.
    const decoy=tj("数据分析师", "实习生招聘 实习");
    ok("REGRESSION card text mentioning the word does not rescue a bad title",
       F.matches(decoy, gate).ok===false, F.matches(decoy, gate));
    ok("the same card would have passed a whole-card keyword check",
       F.matches(decoy, {includeAny:["实习"]}).ok===true);

    ok("several spellings are any-of",
       F.matches(tj("见习数据分析"), {titleIncludeAny:["实习","见习"]}).ok===true);
    ok("an ascii keyword is matched case insensitively",
       F.matches(tj("Data Intern"), {titleIncludeAny:["intern"]}).ok===true);
    ok("an empty list filters nothing", F.matches(tj("数据分析师"), {titleIncludeAny:[]}).ok===true);
    ok("the gate is off by default", F.matches(tj("数据分析师"), {}).ok===true);

    // it composes with the topic list rather than replacing it
    const both={ titleIncludeAny:["实习"], includeAny:["数据","AI"] };
    ok("title and topics both have to hold", F.matches(tj("数据分析实习"), both).ok===true);
    ok("right topic but wrong title is rejected", F.matches(tj("数据分析师"), both).ok===false);
    ok("right title but wrong topic is rejected", F.matches(tj("前端开发实习"), both).ok===false);
  })();
  ok("DEFAULT_CONFIG declares titleIncludeAny", "titleIncludeAny" in B.store.DEFAULT_CONFIG);
  ok("popup.js saves titleIncludeAny",
     fs.readFileSync(D+"src/popup/popup.js","utf8").indexOf("titleIncludeAny")>=0);
  ok("popup.html has a control for it",
     fs.readFileSync(D+"src/popup/popup.html","utf8").indexOf('id="titleIncludeAny"')>=0);

  console.log("\n[14] scanAll sweeps the whole feed, not just the rendered batch");
  // awaited: an un-awaited async block would let the summary print before these ever ran
  await (async function(){
    const SC = ctx.window.BAG.scanner;
    const BATCH = 5, MAXB = 4;
    let feed = [], batches = 0, captcha = false;
    function mkc(i){
      const c = { name:"数据实习生 "+i, tags:["在校/应届"], location:"上海", jobId:"g"+i,
                  company:"X公司", salary:"20-30K", url:"/job_detail/g"+i+".html" };
      c._raw = [c.name,c.company,c.tags.join(" "),c.location,c.salary].join(" ");
      // the feed only renders the next batch once the last card is scrolled into view
      c.scrollIntoView = function(){ if (batches < MAXB) { batches++; render(); } };
      return c;
    }
    function render(){ feed = []; for (let i=0;i<batches*BATCH;i++) feed.push(mkc(i)); }
    function reset(){ batches = 1; render(); DB = { config:{ searchQuery:"实习", includeAny:[], cities:["上海"] } }; }
    ctx.window.BAG.dom = { getAllCards:function(){ return feed; }, parseCard:function(c){ return c; },
                           detectCaptcha:function(){ return captcha; } };

    reset();
    const seen = [];
    let r = await SC.scanAll(async function(p){ seen.push(p.cards); });
    eq("REGRESSION every batch of the feed reaches the queue, not only the first",
       (DB.queue||[]).length, BATCH*MAXB);
    eq("the report describes the whole feed", r.total, BATCH*MAXB);
    eq("each job is counted once across batches", r.added, BATCH*MAXB);
    ok("it kept pulling until the feed stopped growing", r.batches >= MAXB, r.batches);
    ok("progress was reported per batch, with a growing card count",
       seen.length >= MAXB-1 && seen[0] < seen[seen.length-1], seen);
    eq("a completed sweep is not flagged as interrupted", r.stopped, "");
    ok("it did not run away past the cap", r.batches <= SC.MAX_SCAN_BATCHES, r.batches);

    reset();
    let calls = 0;
    r = await SC.scanAll(null, async function(){ calls++; return calls <= 1; });
    eq("a second click stops the sweep between batches", r.stopped, "stopped");
    ok("it stopped early instead of walking the whole feed",
       (DB.queue||[]).length < BATCH*MAXB, (DB.queue||[]).length);

    reset();
    captcha = true;
    r = await SC.scanAll();
    eq("a captcha stops the sweep instead of hammering the site", r.stopped, "captcha");
    eq("only what was already rendered got queued", (DB.queue||[]).length, BATCH);
    captcha = false;

    reset();
    batches = 1; render();
    r = await SC.scanAll(null, async function(){ return true; });
    eq("a feed that never grows still reports its one batch", r.total, BATCH*MAXB);
  })();

  console.log("\n[14b] the sweep is wired into the panel and shares one scroll helper");
  (function(){
    const sc = fs.readFileSync(D+"src/content/scanner.js","utf8");
    const ex = fs.readFileSync(D+"src/content/executor.js","utf8");
    const pl = fs.readFileSync(D+"src/content/panel.js","utf8");
    ok("scanner owns the scroll helper", /function loadMoreCards/.test(sc));
    ok("executor reuses it rather than keeping a copy",
       ex.indexOf("B.scanner.loadMoreCards()")>=0 && !/function loadMoreCards/.test(ex));
    ok("the scroll helper moves the last card, not the window",
       /scrollIntoView\(\{ block: "end"/.test(sc));
    ok("panel button sweeps the feed", pl.indexOf("scanAll")>=0);
    ok("panel button can be clicked again to stop", pl.indexOf("停止扫描")>=0);
    ok("the old page-only label is gone", pl.indexOf("扫描本页")===-1);
  })();

  console.log("\n[15] internship searches pin Boss's 在校生 experience filter");
  (function(){
    const C=B.cities, U=C.buildSearchUrl, SM=C.searchMatchesAt;
    const intern={ jobType:"intern", searchQuery:"实习生", cities:["深圳"] };
    const full={ jobType:"fulltime", searchQuery:"算法", cities:["深圳"] };

    ok("an internship search carries experience=108", U(intern).indexOf("experience=108")>=0, U(intern));
    ok("it still carries the query and the city",
       U(intern).indexOf("query=")>=0 && U(intern).indexOf("city=101280600")>=0, U(intern));
    ok("a full time search adds nothing extra", U(full).indexOf("experience")===-1, U(full));
    ok("a config without jobType behaves like full time",
       U({ searchQuery:"算法", cities:["深圳"] }).indexOf("experience")===-1);

    const q="?query="+encodeURIComponent("实习生")+"&city=101280600";
    ok("REGRESSION same words but no 在校生 filter is NOT a match",
       SM(intern, "/web/geek/jobs", q)===false);
    ok("with the filter it matches", SM(intern, "/web/geek/jobs", q+"&experience=108")===true);
    ok("在校生 picked alongside 应届生 still matches",
       SM(intern, "/web/geek/jobs", q+"&experience=108,102")===true);
    ok("a different experience value alone does not count",
       SM(intern, "/web/geek/jobs", q+"&experience=102")===false);
    ok("108 inside another number is not mistaken for it",
       SM(intern, "/web/geek/jobs", q+"&experience=1108")===false);
    ok("the user's other site filters are still preserved",
       SM(intern, "/web/geek/jobs", q+"&experience=108&degree=203")===true);

    const qf="?query="+encodeURIComponent("算法")+"&city=101280600";
    ok("a full time search does not care about the experience filter",
       SM(full, "/web/geek/jobs", qf)===true);
    ok("a full time search is fine with the filter present too",
       SM(full, "/web/geek/jobs", qf+"&experience=108")===true);

    ok("hasStudentExperience reads the parameter directly",
       C.hasStudentExperience("?experience=108")===true && C.hasStudentExperience("?experience=101")===false &&
       C.hasStudentExperience("")===false);
    eq("the code is stated once, not scattered", C.EXP_STUDENT, "108");
  })();
  ok("DEFAULT_CONFIG declares jobType", "jobType" in B.store.DEFAULT_CONFIG);
  eq("it defaults to full time so nothing changes until chosen", B.store.DEFAULT_CONFIG.jobType, "fulltime");
  ok("popup.js saves jobType",
     fs.readFileSync(D+"src/popup/popup.js","utf8").indexOf("jobType")>=0);
  ok("popup.html has a control for it",
     fs.readFileSync(D+"src/popup/popup.html","utf8").indexOf('id="jobType"')>=0);
  ok("the job type control sits above the search term",
     (function(){ const t=fs.readFileSync(D+"src/popup/popup.html","utf8");
       return t.indexOf('id="jobType"') < t.indexOf('id="searchQuery"'); })());
  ok("the panel explains a missing 在校生 filter instead of just reporting a mismatch",
     fs.readFileSync(D+"src/content/panel.js","utf8").indexOf("hasStudentExperience")>=0);

  console.log("\n[16] an empty search term is a valid setting");
  (function(){
    const C=B.cities, U=C.buildSearchUrl, SM=C.searchMatchesAt, HD=C.hasDestination;

    const cityOnly={ searchQuery:"", cities:["上海"] };
    eq("an empty term still emits the query parameter, plus the city",
       U(cityOnly), "https://www.zhipin.com/web/geek/jobs?query=&city=101020100");
    ok("REGRESSION query= with a city is a real search page, not the recommendation feed",
       C.isSearchPageAt("/web/geek/jobs", "?query=&city=101020100")===true);
    ok("dropping the query parameter is what makes it the recommendation feed",
       C.isSearchPageAt("/web/geek/jobs", "?city=101020100")===false);

    ok("a city alone is a destination", HD(cityOnly)===true);
    ok("a search term alone is a destination", HD({ searchQuery:"算法", cities:[] })===true);
    ok("neither is not a destination", HD({ searchQuery:"", cities:[] })===false);
    ok("an undefined config is not a destination", HD(undefined)===false);

    ok("an empty term matches the city's full list",
       SM(cityOnly, "/web/geek/jobs", "?query=&city=101020100")===true);
    ok("an empty term does not match a page that is searching for something",
       SM(cityOnly, "/web/geek/jobs", "?query="+encodeURIComponent("算法")+"&city=101020100")===false);
    ok("a configured term does not match an empty page query",
       SM({ searchQuery:"算法", cities:["上海"] }, "/web/geek/jobs", "?query=&city=101020100")===false);
    ok("the wrong city still fails with an empty term",
       SM(cityOnly, "/web/geek/jobs", "?query=&city=101280600")===false);
    ok("an internship browse still pins 在校生",
       SM({ jobType:"intern", searchQuery:"", cities:["上海"] }, "/web/geek/jobs", "?query=&city=101020100")===false &&
       SM({ jobType:"intern", searchQuery:"", cities:["上海"] }, "/web/geek/jobs", "?query=&city=101020100&experience=108")===true);
    ok("an internship browse URL carries both",
       U({ jobType:"intern", searchQuery:"", cities:["上海"] }).indexOf("query=&city=101020100&experience=108")>=0,
       U({ jobType:"intern", searchQuery:"", cities:["上海"] }));

    const pl=fs.readFileSync(D+"src/content/panel.js","utf8");
    const ex=fs.readFileSync(D+"src/content/executor.js","utf8");
    ok("the panel gates on a destination, not on a search term", pl.indexOf("hasDestination(cfg)")>=0);
    ok("the standing notice gates on a destination too", pl.indexOf("hasDestination(config)")>=0);
    ok("the panel no longer demands a search term",
       pl.indexOf("在「搜索词」里填岗位关键词")===-1);
    ok("resuming a run gates on a destination", ex.indexOf("hasDestination(cfg)")>=0);
    ok("the notice has wording for an empty term", pl.indexOf("不限搜索词")>=0);
  })();

  console.log("\n[17] the 公司规模 sweep walks one code per round");
  await (async function(){
    const SC = ctx.window.BAG.scanner, C = B.cities;

    // a navigable location: assigning href records the jump and moves the fake page there
    let navs = [];
    const loc = { pathname:"/other", search:"" };
    Object.defineProperty(loc, "href", {
      get: function(){ return "https://www.zhipin.com" + loc.pathname + loc.search; },
      set: function(u){
        navs.push(String(u));
        const m = String(u).match(/^https?:\/\/[^/]+([^?]*)(\?.*)?$/);
        loc.pathname = m ? m[1] : "/";
        loc.search = (m && m[2]) ? m[2] : "";
      }
    });
    ctx.location = loc;

    // a feed that never grows, so every round finishes after its first batch
    const cards = [1,2,3].map(function(i){
      const c = { name:"算法实习生 "+i, company:"X公司", salary:"20-30K", location:"上海",
                  tags:["在校/应届"], jobId:"s"+i, url:"/job_detail/s"+i+".html" };
      c._raw = [c.name,c.company,c.tags.join(" "),c.location,c.salary].join(" ");
      c.scrollIntoView = function(){};
      return c;
    });
    ctx.window.BAG.dom = { getAllCards:function(){ return cards; }, parseCard:function(c){ return c; },
                           detectCaptcha:function(){ return false; } };

    const cfg = { searchQuery:"算法", cities:["上海"], scaleSweep:true, scaleOrder:["304","303"], includeAny:[] };
    function reset(){ DB = { config:cfg }; navs = []; loc.pathname = "/other"; loc.search = ""; }

    reset();
    await SC.sweepStart();
    eq("round one is the unfiltered search", navs[0], C.buildSearchUrl(cfg, ""));
    eq("the sweep starts with no scale at all, then the configured codes",
       (DB.sweep||{}).shards, ["", "304", "303"]);

    await SC.sweepStep();          // now on round one, scan it and move to the next
    eq("round two carries a single code", navs[navs.length-1], C.buildSearchUrl(cfg, "304"));
    await SC.sweepStep();
    eq("round three carries the next code alone", navs[navs.length-1], C.buildSearchUrl(cfg, "303"));
    await SC.sweepStep();          // last round, then finish

    const sw = DB.sweep;
    eq("every round was recorded in order", sw.rounds.map(function(r){ return r.shard; }), ["", "304", "303"]);
    eq("the queue kept the jobs found", (DB.queue||[]).length, cards.length);
    eq("the sweep ends inactive", sw.active, false);
    ok("the report names the rounds", (DB.statusMsg||"").indexOf("规模轮扫完成")>=0, DB.statusMsg);
    eq("it returns to the plain search instead of leaving a filter on",
       navs[navs.length-1], C.buildSearchUrl(cfg, ""));

    // THE EXPLICIT REQUIREMENT: one code per round, never several at once
    ok("REGRESSION no URL ever combines codes",
       navs.every(function(u){ return u.indexOf(",")===-1 && (u.match(/scale=/g)||[]).length<=1; }), navs);
    ok("REGRESSION the codes appear on their own, in order",
       navs.filter(function(u){ return u.indexOf("scale=")>=0; })
           .map(function(u){ return u.split("scale=")[1]; }).join("|") === "304|303",
       navs);

    // a round the site will not show is skipped, not retried forever
    reset();
    await SC.sweepStart();
    for (let i=0;i<12;i++){ loc.pathname = "/other"; loc.search = ""; await SC.sweepStep(); }
    const sw2 = DB.sweep;
    eq("an unreachable sweep still terminates", sw2.active, false);
    ok("every unreachable round is marked skipped rather than scanned",
       sw2.rounds.length===3 && sw2.rounds.every(function(r){ return r.skipped===true; }), sw2.rounds);
    eq("retries per round are bounded", SC.MAX_NAV_TRIES, 3);

    // stopping mid sweep
    reset();
    await SC.sweepStart();
    await SC.sweepStop();
    await SC.sweepStep();
    eq("a stopped sweep does nothing further", (DB.sweep||{}).active, false);

    // an absurd order cannot spawn an endless number of rounds
    DB = { config: Object.assign({}, cfg, { scaleOrder: "abcdefghijklmnopqrst".split("") }) };
    navs = []; loc.pathname = "/other"; loc.search = "";
    await SC.sweepStart();
    ok("the number of rounds is capped", DB.sweep.shards.length <= SC.MAX_SHARDS, DB.sweep.shards.length);
    await SC.sweepStop();
  })();

  console.log("\n[17b] sweep settings and controls are wired up");
  (function(){
    ok("DEFAULT_CONFIG declares scaleSweep", "scaleSweep" in B.store.DEFAULT_CONFIG);
    ok("DEFAULT_CONFIG declares scaleOrder", "scaleOrder" in B.store.DEFAULT_CONFIG);
    eq("the default order is the four codes, unfiltered round excluded",
       B.store.DEFAULT_CONFIG.scaleOrder, ["304","303","305","306"]);
    eq("the sweep is off by default", B.store.DEFAULT_CONFIG.scaleSweep, false);
    const ph = fs.readFileSync(D+"src/popup/popup.html","utf8");
    const pj = fs.readFileSync(D+"src/popup/popup.js","utf8");
    const pl = fs.readFileSync(D+"src/content/panel.js","utf8");
    ok("popup has both controls", ph.indexOf('id="scaleSweep"')>=0 && ph.indexOf('id="scaleOrder"')>=0);
    ok("popup saves both", pj.indexOf("scaleSweep")>=0 && pj.indexOf("scaleOrder")>=0);
    ok("the scan button starts a sweep when enabled", pl.indexOf("sweepStart()")>=0);
    ok("the scan button stops a running sweep", pl.indexOf("sweepStop()")>=0);
    ok("a page load resumes the sweep", pl.indexOf("sweepStep()")>=0);
    ok("the button is relabelled from stored state, not a local flag",
       pl.indexOf("bag-scanbtn")>=0 && pl.indexOf('sweep.active ? "停止扫描"')>=0);
    ok("the mismatch notice is suppressed while a sweep owns the page", pl.indexOf("!sweep.active")>=0);
  })();

  console.log("\n" + (fail? "###### "+fail+" FAILED, "+pass+" passed ######" : "###### ALL "+pass+" TESTS PASSED ######"));
  process.exit(fail?1:0);
})();
