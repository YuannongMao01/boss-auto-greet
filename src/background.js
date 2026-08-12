// Service worker: relays desktop notifications and resets the daily counter across day boundaries.
chrome.runtime.onMessage.addListener(function (msg) {
  if (msg && msg.type === "notify") {
    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: msg.title || "Boss Auto Greet",
      message: msg.message || ""
    });
  }
});

// Check hourly and reset the daily counter once the date has changed
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
