// City name to Boss city code, plus search page URL construction from the config.
window.BAG = window.BAG || {};
(function () {
  const CITY_CODE = {
    "全国": "100010000", "北京": "101010100", "上海": "101020100", "广州": "101280100",
    "深圳": "101280600", "杭州": "101210100", "南京": "101190100", "苏州": "101190400",
    "成都": "101270100", "武汉": "101200100", "西安": "101110100", "天津": "101030100",
    "重庆": "101040100", "长沙": "101250100", "郑州": "101180100", "青岛": "101120200",
    "济南": "101120100", "合肥": "101220100", "福州": "101230100", "厦门": "101230200",
    "宁波": "101210400", "东莞": "101281600", "佛山": "101280800", "无锡": "101190200",
    "大连": "101070200", "沈阳": "101070100", "昆明": "101290100", "珠海": "101280700"
  };

  function cityCode(name) {
    if (!name) return null;
    for (const k in CITY_CODE) {
      if (name.indexOf(k) !== -1 || k.indexOf(name) !== -1) return CITY_CODE[k];
    }
    return null;
  }

  // Build the search URL. The query is config.searchQuery, the city is the first one configured.
  function buildSearchUrl(config) {
    const kw = config.searchQuery || "";
    const code = (config.cities && config.cities[0]) ? cityCode(config.cities[0]) : null;
    let url = "https://www.zhipin.com/web/geek/jobs?query=" + encodeURIComponent(kw);
    if (code) url += "&city=" + code;
    return url;
  }

  function isSearchPageAt(pathname, search) {
    if (pathname === "/web/geek/job") return true;                // legacy singular search path
    if (pathname === "/web/geek/jobs") return new URLSearchParams(search).has("query"); // plural path is only a search when a query is present
    return false;                                                 // /web/geek/jobs without a query is the recommendation feed
  }
  function isSearchPage() { return isSearchPageAt(location.pathname, location.search); }

  // Is the search shown by this URL the one the config asks for? Only the query and the city are
  // compared, so any extra filters the user applied through the site's own UI are preserved.
  function searchMatchesAt(config, pathname, search) {
    if (!isSearchPageAt(pathname, search)) return false;
    const p = new URLSearchParams(search);
    if ((p.get("query") || "") !== (config.searchQuery || "")) return false;
    const wanted = (config.cities && config.cities[0]) ? cityCode(config.cities[0]) : null;
    if (wanted && (p.get("city") || "") !== wanted) return false;
    return true;
  }
  function searchMatches(config) { return searchMatchesAt(config, location.pathname, location.search); }
  function currentQuery() { return new URLSearchParams(location.search).get("query") || ""; }

  window.BAG.cities = {
    CITY_CODE: CITY_CODE, cityCode: cityCode, buildSearchUrl: buildSearchUrl,
    isSearchPage: isSearchPage, isSearchPageAt: isSearchPageAt,
    searchMatches: searchMatches, searchMatchesAt: searchMatchesAt, currentQuery: currentQuery
  };
})();
