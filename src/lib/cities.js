// 城市名 -> Boss 城市代码；根据配置构造搜索页 URL。
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

  // 构造搜索 URL：搜索词 = config.searchQuery，城市取第一个
  function buildSearchUrl(config) {
    const kw = config.searchQuery || "";
    const code = (config.cities && config.cities[0]) ? cityCode(config.cities[0]) : null;
    let url = "https://www.zhipin.com/web/geek/jobs?query=" + encodeURIComponent(kw);
    if (code) url += "&city=" + code;
    return url;
  }

  function isSearchPage() {
    const p = location.pathname;
    if (p === "/web/geek/job") return true;                       // 旧单数搜索页
    if (p === "/web/geek/jobs") return new URLSearchParams(location.search).has("query"); // 复数：带 query 才是搜索
    return false;                                                 // /web/geek/jobs 无 query = 推荐页
  }

  window.BAG.cities = { CITY_CODE: CITY_CODE, cityCode: cityCode, buildSearchUrl: buildSearchUrl, isSearchPage: isSearchPage };
})();
