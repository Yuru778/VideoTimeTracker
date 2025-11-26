// background.js
// 目前僅用於監聽安裝事件，未來可擴充

chrome.runtime.onInstalled.addListener(() => {
    console.log("Google Skills Tracker extension installed.");
});
