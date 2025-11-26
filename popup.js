// popup.js

function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function updateUI() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('date').textContent = today;

    chrome.storage.sync.get([today], (result) => {
        const data = result[today] || { videoTime: 0, interactionTime: 0, totalTime: 0 };
        
        document.getElementById('videoTime').textContent = formatTime(data.videoTime);
        document.getElementById('interactionTime').textContent = formatTime(data.interactionTime);
        document.getElementById('totalTime').textContent = formatTime(data.totalTime);
    });
}

// 初始化設定與監聽器
document.addEventListener('DOMContentLoaded', () => {
    updateUI();

    // 讀取懸浮窗開關狀態 (預設開啟)
    const toggle = document.getElementById('toggleOverlay');
    
    // 讀取設定
    chrome.storage.local.get(['showOverlay'], (result) => {
        // 如果沒有設定過，預設為 true
        toggle.checked = result.showOverlay !== false;
    });

    // 監聽開關變更
    toggle.addEventListener('change', (e) => {
        const isChecked = e.target.checked;
        // 儲存設定
        chrome.storage.local.set({ showOverlay: isChecked });
        
        // 通知當前分頁更新
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    type: 'TOGGLE_OVERLAY',
                    show: isChecked
                });
            }
        });
    });

    // 開啟 Popup 時每秒自動刷新數據
    setInterval(updateUI, 1000);
});