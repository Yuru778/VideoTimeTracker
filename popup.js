// popup.js

// --- Utils ---
function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function getDaysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
}

// --- State ---
let currentDate = new Date(); // 用於月曆顯示
let allData = {}; // 快取所有數據

// --- Core Functions ---
async function loadData() {
    return new Promise((resolve) => {
        chrome.storage.sync.get(null, (items) => {
            allData = items;
            resolve(items);
        });
    });
}

function updateDashboard() {
    const todayStr = new Date().toISOString().split('T')[0];
    document.getElementById('date').textContent = todayStr;
    
    const data = allData[todayStr] || { videoTime: 0, interactionTime: 0, totalTime: 0 };
    document.getElementById('videoTime').textContent = formatTime(data.videoTime);
    document.getElementById('interactionTime').textContent = formatTime(data.interactionTime);
    document.getElementById('totalTime').textContent = formatTime(data.totalTime);
}

function renderCalendar() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth(); // 0-11
    
    document.getElementById('currentMonthLabel').textContent = `${year} 年 ${month + 1} 月`;
    
    const grid = document.getElementById('calendar');
    grid.innerHTML = '';

    // 取得當月第一天是星期幾 (0=Sun, 1=Mon...)
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = getDaysInMonth(year, month);

    // 填充空白
    for (let i = 0; i < firstDay; i++) {
        const cell = document.createElement('div');
        cell.className = 'cal-day empty';
        grid.appendChild(cell);
    }

    // 填充日期
    let monthlyTotalSecs = 0;
    let monthlyDays = 0;

    for (let day = 1; day <= daysInMonth; day++) {
        const cell = document.createElement('div');
        cell.className = 'cal-day';
        cell.textContent = day;
        
        const dateStr = `${year}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
        const todayStr = new Date().toISOString().split('T')[0];
        
        if (dateStr === todayStr) cell.classList.add('today');

        const dayData = allData[dateStr];
        if (dayData) {
            cell.classList.add('has-data');
            monthlyTotalSecs += (dayData.interactionTime || 0); // 使用互動時間作為主要學習指標
            monthlyDays++;

            // Tooltip
            const tooltip = document.createElement('div');
            tooltip.className = 'tooltip';
            tooltip.innerHTML = `
                <strong>${dateStr}</strong><br>
                🎥 播放: ${formatTime(dayData.videoTime)}<br>
                ⚡ 互動: ${formatTime(dayData.interactionTime)}<br>
                ⏳ 掛機: ${formatTime(dayData.totalTime)}
            `;
            cell.appendChild(tooltip);
        }

        grid.appendChild(cell);
    }

    // 更新統計摘要
    document.getElementById('total-learning').textContent = (monthlyTotalSecs / 3600).toFixed(1) + 'h';
    document.getElementById('total-days').textContent = monthlyDays;
}

function exportToCSV() {
    let csvContent = "\uFEFF"; // BOM for Excel UTF-8
    csvContent += "日期,影片播放時間,專注互動時間,總掛機時間,影片秒數,互動秒數,總秒數\n";

    // 排序日期
    const dates = Object.keys(allData).sort().reverse();
    
    dates.forEach(date => {
        // 過濾非日期格式的 key (如設定值)
        if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) return;

        const d = allData[date];
        csvContent += `${date},${formatTime(d.videoTime)},${formatTime(d.interactionTime)},${formatTime(d.totalTime)},${d.videoTime},${d.interactionTime},${d.totalTime}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `learning_stats_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', async () => {
    // 載入數據
    await loadData();
    updateDashboard();
    
    // 切換頁面
    const pageDash = document.getElementById('page-dashboard');
    const pageHist = document.getElementById('page-history');
    
    document.getElementById('btn-history').addEventListener('click', () => {
        pageDash.classList.add('hidden');
        pageHist.classList.remove('hidden');
        renderCalendar();
    });

    document.getElementById('btn-back').addEventListener('click', () => {
        pageHist.classList.add('hidden');
        pageDash.classList.remove('hidden');
    });

    // 月曆控制
    document.getElementById('prevMonth').addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() - 1);
        renderCalendar();
    });
    document.getElementById('nextMonth').addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() + 1);
        renderCalendar();
    });

    // 匯出
    document.getElementById('btn-export').addEventListener('click', exportToCSV);

    // 開關
    const toggle = document.getElementById('toggleOverlay');
    chrome.storage.local.get(['showOverlay'], (res) => {
        toggle.checked = res.showOverlay !== false;
    });
    toggle.addEventListener('change', (e) => {
        chrome.storage.local.set({ showOverlay: e.target.checked });
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_OVERLAY', show: e.target.checked });
        });
    });

    // 自動刷新 (Dashboard)
    setInterval(async () => {
        if (!pageDash.classList.contains('hidden')) {
            await loadData();
            updateDashboard();
        }
    }, 1000);
});
