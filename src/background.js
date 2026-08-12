// Service worker：转发桌面通知 + 每日计数跨日重置检查。
chrome.runtime.onMessage.addListener(function (msg) {
  if (msg && msg.type === "notify") {
    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: msg.title || "Boss 招呼助手",
      message: msg.message || ""
    });
  }
});

// 每小时检查一次，跨日则重置每日计数
chrome.runtime.onInstalled.addListener(function () {
  chrome.alarms.create("dailyReset", { periodInMinutes: 60 });
});
chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name !== "dailyReset") return;
  const today = new Date().toISOString().slice(0, 10);
  chrome.storage.local.get("dailyCount", function (o) {
    const dc = o.dailyCount;
    if (dc && dc.date !== today) {
      chrome.storage.local.set({ dailyCount: { date: today, count: 0 } });
    }
  });
});
