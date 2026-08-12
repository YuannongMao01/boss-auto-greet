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

console.log("\n[2] filters.matches with mustInclude / exclude / city / salary");
const job={ name:"SLAM算法实习生", company:"某某科技", tags:["在校/应届","本科"], location:"上海·浦东新区", salary:"200-300元/天" };
job._raw=[job.name,job.company,job.tags.join(" "),job.location,job.salary].join(" ");
eq("mustInclude empty -> ok", F.matches(job,{mustInclude:[]}), {ok:true});
eq("mustInclude single hit -> ok", F.matches(job,{mustInclude:["算法"]}), {ok:true});
const r1=F.matches(job,{mustInclude:["实习","Python"]});
ok("mustInclude missing word -> rejected w/ reason", r1.ok===false && r1.reason.indexOf("Python")>=0, r1);
const cardOnly={ name:"SLAM算法", company:"某某科技", tags:["1-3年","本科"], location:"上海" };
cardOnly._raw=[cardOnly.name,cardOnly.company,cardOnly.tags.join(" "),cardOnly.location].join(" ");
const r2=F.matches(cardOnly,{mustInclude:["实习"]});
ok("regression: term absent from card text -> reason names that term", r2.ok===false && r2.reason==="缺少必含词「实习」", r2);
const r3=F.matches(cardOnly,{excludeKeywords:["外包","SLAM"]});
ok("exclude hit", r3.ok===false && r3.reason.indexOf("SLAM")>=0, r3);
const r4=F.matches(cardOnly,{cities:["杭州"]});
ok("city mismatch", r4.ok===false && r4.reason==="城市不匹配", r4);
eq("city match", F.matches(cardOnly,{cities:["上海"]}), {ok:true});
const r5=F.matches({name:"x",salary:"10-15K",_raw:"x"},{minSalary:20});
ok("salary below floor", r5.ok===false && r5.reason==="薪资低于下限", r5);
eq("salary unknown passes", F.matches({name:"x",salary:"面议",_raw:"x"},{minSalary:20}), {ok:true});
ok("no matchMode/keywords left in filters", !/matchMode|config\.keywords/.test(fs.readFileSync(D+"src/lib/filters.js","utf8")));

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

console.log("\n[5] store.getConfig legacy migration (keywords -> searchQuery + mustInclude)");
(async function(){
  DB={ config:{ keywords:["算法","实习"], matchMode:"and", cities:["上海"], greeting:"hi" } };
  let c=await B.store.getConfig();
  eq("keywords[0] -> searchQuery", c.searchQuery, "算法");
  eq("keywords[1:] -> mustInclude", c.mustInclude, ["实习"]);
  eq("other fields kept", c.cities, ["上海"]);

  DB={ config:{ keywords:["算法实习"] } };
  c=await B.store.getConfig();
  eq("single keyword -> searchQuery only", [c.searchQuery,c.mustInclude], ["算法实习",[]]);

  DB={ config:{ searchQuery:"算法实习", mustInclude:[] } };
  c=await B.store.getConfig();
  eq("new config untouched", [c.searchQuery,c.mustInclude], ["算法实习",[]]);
  ok("defaults present", c.dailyCap>0 && typeof c.intervalMin==="number", {cap:c.dailyCap});

  DB={};
  c=await B.store.getConfig();
  eq("fresh install defaults", [c.searchQuery,c.mustInclude,c.excludeKeywords], ["",[],[]]);

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

  DB={ config:{ searchQuery:"算法", mustInclude:["实习"], cities:["上海"] } };
  let r=await ctx.window.BAG.scanner.scanOnce();
  eq("all filtered", [r.total,r.added,r.filtered], [4,0,4]);
  eq("topReason names the culprit", r.topReason, "缺少必含词「实习」");
  eq("topCount", r.topCount, 4);

  DB={ config:{ searchQuery:"算法", mustInclude:[], excludeKeywords:["销售"], cities:["上海"] } };
  r=await ctx.window.BAG.scanner.scanOnce();
  eq("3 added, 1 excluded", [r.added,r.filtered], [3,1]);
  eq("reason = exclude", r.topReason, "命中屏蔽词「销售」");
  eq("queue got 3", (DB.queue||[]).length, 3);

  r=await ctx.window.BAG.scanner.scanOnce();
  eq("re-scan: nothing new, 3 already in queue", [r.added,r.inQueue], [0,3]);

  DB.queue=[]; DB.greetedJobs=["j1"];
  r=await ctx.window.BAG.scanner.scanOnce();
  eq("after clearing queue: greeted j1 stays out, 2 re-added", [r.added,r.greeted,r.filtered], [2,1,1]);

  console.log("\n[8] no legacy field references anywhere");
  ["src/content/panel.js","src/content/executor.js","src/popup/popup.js","src/popup/popup.html","src/lib/filters.js","src/lib/cities.js"].forEach(function(f){
    const t=fs.readFileSync(D+f,"utf8");
    ok(f+" clean of cfg.keywords/matchMode", !/cfg\.keywords|config\.keywords|matchMode|id="keywords"/.test(t));
  });
  const pan=fs.readFileSync(D+"src/content/panel.js","utf8");
  ok("panel version bumped to v14", /BAG_VERSION = "v14"/.test(pan));
  ok("panel shows top reason", pan.indexOf("主要原因")>0);

  console.log("\n" + (fail? "###### "+fail+" FAILED, "+pass+" passed ######" : "###### ALL "+pass+" TESTS PASSED ######"));
  process.exit(fail?1:0);
})();
