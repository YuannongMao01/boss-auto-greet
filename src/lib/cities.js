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

  function isSearchPage() {
    const p = location.pathname;
    if (p === "/web/geek/job") return true;                       // legacy singular search path
    if (p === "/web/geek/jobs") return new URLSearchParams(location.search).has("query"); // plural path is only a search when a query is present
    return false;                                                 // /web/geek/jobs without a query is the recommendation feed
  }

  window.BAG.cities = { CITY_CODE: CITY_CODE, cityCode: cityCode, buildSearchUrl: buildSearchUrl, isSearchPage: isSearchPage };
})();
