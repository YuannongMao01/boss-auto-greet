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

console.log("\n[1] filters.parseSalaryLowerK");
const F=B.filters;
eq("15-25K", F.parseSalaryLowerK("15-25K"), 15);
eq("K unit with month-count suffix", F.parseSalaryLowerK("20K·13薪"), 20);
eq("mixed CJK units, first unit wins", F.parseSalaryLowerK("8千-1.2万"), 8);
eq("CJK ten-thousand unit scales to K", F.parseSalaryLowerK("1-1.5万"), 10);
eq("negotiable -> null", F.parseSalaryLowerK("面议"), null);
eq("hidden salary -> null", F.parseSalaryLowerK("-K·薪"), null);

console.log("\n[2] filters.matches with topic keywords / exclude / city / salary");
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
const r5=F.matches({name:"x",salary:"10-15K",_raw:"x"},{minSalary:20});
ok("salary below floor", r5.ok===false && r5.reason==="薪资低于下限", r5);
eq("salary unknown passes", F.matches({name:"x",salary:"面议",_raw:"x"},{minSalary:20}), {ok:true});
ok("filters has no all-of leftovers",
   !/matchMode|config\.keywords|mustInclude/.test(fs.readFileSync(D+"src/lib/filters.js","utf8")));

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
  DB={ config:{ searchQuery:"实习", mustInclude:["数据"], includeAny:["AI"] } };
  c=await B.store.getConfig();
  eq("an existing includeAny wins over the legacy field", c.includeAny, ["AI"]);
  ok("defaults present", c.dailyCap>0 && typeof c.intervalMin==="number", {cap:c.dailyCap});

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

  console.log("\n[10] company quality filters");
  eq("headcount range -> lower bound", F.parseCompanyScale("互联网 已上市 100-499人").min, 100);
  eq("smallest bucket", F.parseCompanyScale("0-20人").min, 0);
  eq("20-99人", F.parseCompanyScale("电子商务 A轮 20-99人").min, 20);
  eq("1000-9999人", F.parseCompanyScale("1000-9999人").min, 1000);
  eq("open ended bucket", F.parseCompanyScale("10000人以上").min, 10000);
  eq("label is reported back for the panel", F.parseCompanyScale("10000人以上").text, "10000人以上");
  eq("no headcount on the card -> null", F.parseCompanyScale("互联网 已上市").min, null);
  eq("a salary range is not read as a headcount", F.parseCompanyScale("15-25K·13薪").min, null);

  eq("未融资 ranks lowest", F.parseFinancingStage("互联网 未融资 0-20人").rank, 1);
  eq("天使轮", F.parseFinancingStage("天使轮").rank, 2);
  eq("A轮", F.parseFinancingStage("A轮").rank, 3);
  eq("已上市 ranks top", F.parseFinancingStage("已上市").rank, 7);
  eq("REGRESSION 不需要融资 is not read as 未融资", F.parseFinancingStage("不需要融资").rank, 7);
  eq("REGRESSION D轮及以上 is not read as D轮 only", F.parseFinancingStage("D轮及以上").text, "D轮及以上");
  eq("no stage on the card -> null", F.parseFinancingStage("互联网 500-999人").rank, null);

  function co(name, extra){
    const c={ name:"数据分析实习生", company:name, salary:"200-300元/天", location:"上海·浦东新区", tags:["在校/应届"] };
    c._raw=[c.name,c.company,c.tags.join(" "),c.location,c.salary,extra||""].join(" ");
    return c;
  }
  const big=co("大厂科技","互联网 已上市 10000人以上");
  const tiny=co("小小信息","互联网 未融资 0-20人");
  const blank=co("某某科技","");

  ok("no company rules -> everything passes", F.matches(tiny,{}).ok===true);
  ok("headcount floor keeps a large company", F.matches(big,{minCompanyScale:500}).ok===true);
  const rs=F.matches(tiny,{minCompanyScale:500});
  ok("headcount floor rejects a tiny company and names its size",
     rs.ok===false && rs.reason.indexOf("0-20人")>=0, rs);
  ok("an unknown headcount is kept rather than rejected", F.matches(blank,{minCompanyScale:10000}).ok===true);

  ok("stage floor keeps a listed company", F.matches(big,{minFinancingRank:6}).ok===true);
  const rf=F.matches(tiny,{minFinancingRank:3});
  ok("stage floor rejects an unfunded company and names the stage",
     rf.ok===false && rf.reason.indexOf("未融资")>=0, rf);
  ok("an unknown stage is kept rather than rejected", F.matches(blank,{minFinancingRank:7}).ok===true);

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

  console.log("\n[10b] company fields are wired through config, popup and the panel row");
  ["excludeCompanies","minCompanyScale","minFinancingRank","blockAgency"].forEach(function(k){
    ok("DEFAULT_CONFIG declares "+k, k in B.store.DEFAULT_CONFIG);
  });
  const coPopupJs=fs.readFileSync(D+"src/popup/popup.js","utf8");
  const coPopupHtml=fs.readFileSync(D+"src/popup/popup.html","utf8");
  ["excludeCompanies","minCompanyScale","minFinancingRank","blockAgency"].forEach(function(k){
    ok("popup.js saves "+k, coPopupJs.indexOf(k)>=0);
    ok("popup.html has a control for "+k, coPopupHtml.indexOf('id="'+k+'"')>=0);
  });
  const coScanner=fs.readFileSync(D+"src/content/scanner.js","utf8");
  ok("scanner stores the company facts on the queue item",
     coScanner.indexOf("companyMeta")>=0 && coScanner.indexOf("scaleText")>=0);
  const coPanel=fs.readFileSync(D+"src/content/panel.js","utf8");
  ok("panel row shows the company facts", coPanel.indexOf("job.scaleText")>=0 && coPanel.indexOf("job.stageText")>=0);

  console.log("\n" + (fail? "###### "+fail+" FAILED, "+pass+" passed ######" : "###### ALL "+pass+" TESTS PASSED ######"));
  process.exit(fail?1:0);
})();
