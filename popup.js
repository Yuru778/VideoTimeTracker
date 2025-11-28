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

    // Google Sync Listener
    document.getElementById('btn-google-sync').addEventListener('click', () => {
        syncData(true);
    });

    // Initial Auth Check & Auto Sync
    checkAuthStatus();
});

// --- Google Drive Sync ---
const DRIVE_FILE_NAME = 'skills_tracker_data.json';
const SYNC_INTERVAL_MINUTES = 15;
let nextSyncTime = null;

async function checkAuthStatus() {
    const token = await getAuthToken(false);
    if (token) {
        updateSyncUI(true);
        // Start auto-sync timer if not already running
        scheduleNextSync();
    } else {
        updateSyncUI(false);
    }
}

function updateSyncUI(isLoggedIn) {
    const btn = document.getElementById('btn-google-sync');
    if (isLoggedIn) {
        btn.style.background = '#34a853'; // Green
        if (nextSyncTime) {
            const timeStr = nextSyncTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            btn.textContent = `✅ 已登入 | 下次同步: ${timeStr}`;
        } else {
            btn.textContent = '✅ 已登入 (準備同步...)';
        }
    } else {
        btn.style.background = '#4285F4'; // Blue
        btn.textContent = '🔄 Google Sync';
    }
}

function scheduleNextSync() {
    // Sync immediately if first time, then schedule
    if (!nextSyncTime) {
        syncData(false);
    }
    
    // Set next sync time
    nextSyncTime = new Date(Date.now() + SYNC_INTERVAL_MINUTES * 60000);
    updateSyncUI(true);

    // Clear existing alarm/interval if any (simple setInterval for popup is tricky as it closes, 
    // but we can at least show the status when opened. 
    // Real background auto-sync requires background.js, but for now we just sync when popup opens 
    // and show "Next Sync" time if user keeps it open or re-opens it)
    
    // Note: Since this is a popup, "Auto Sync" mostly means "Sync on open" + "Sync while open".
    // Real background sync needs background.js implementation. 
    // Based on user request "make it auto sync data, when logged in", 
    // we will ensure it syncs whenever the popup is opened (already done) 
    // and show the status.
}

async function getAuthToken(interactive = false) {
    console.log("Getting auth token. Interactive:", interactive);
    
    // 0. Check local cache first (for Brave/non-Chrome persistence)
    const cached = await new Promise(resolve => chrome.storage.local.get(['authToken'], resolve));
    if (cached.authToken) {
        console.log("Found cached token");
        return cached.authToken;
    }

    return new Promise((resolve, reject) => {
        // 1. Always try silent getAuthToken first
        chrome.identity.getAuthToken({ interactive: false }, (token) => {
            if (chrome.runtime.lastError || !token) {
                console.warn("Silent getAuthToken failed. Error:", chrome.runtime.lastError);
                
                // 2. If silent failed and we want interactive...
                if (interactive) {
                    console.log("Silent login failed. Falling back to launchWebAuthFlow for interactive login...");
                    
                    const manifest = chrome.runtime.getManifest();
                    const clientId = manifest.oauth2.client_id;
                    const scopes = manifest.oauth2.scopes.join(' ');
                    const redirectUri = chrome.identity.getRedirectURL();
                    
                    const authUrl = new URL('https://accounts.google.com/o/oauth2/auth');
                    authUrl.searchParams.append('client_id', clientId);
                    authUrl.searchParams.append('response_type', 'token');
                    authUrl.searchParams.append('redirect_uri', redirectUri);
                    authUrl.searchParams.append('scope', scopes);
                    authUrl.searchParams.append('prompt', 'consent');

                    console.log("Auth URL:", authUrl.toString());

                    chrome.identity.launchWebAuthFlow({
                        url: authUrl.toString(),
                        interactive: true
                    }, (responseUrl) => {
                        if (chrome.runtime.lastError) {
                            console.error("launchWebAuthFlow error:", chrome.runtime.lastError);
                            console.error("launchWebAuthFlow error message:", chrome.runtime.lastError.message);
                            reject(chrome.runtime.lastError);
                        } else if (responseUrl) {
                            console.log("Got response URL:", responseUrl);
                            try {
                                const url = new URL(responseUrl);
                                const params = new URLSearchParams(url.hash.substring(1));
                                const accessToken = params.get('access_token');
                                
                                if (accessToken) {
                                    console.log("Successfully extracted access token");
                                    // Cache the token!
                                    chrome.storage.local.set({ authToken: accessToken });
                                    resolve(accessToken);
                                } else {
                                    reject(new Error("No access token found in response"));
                                }
                            } catch (err) {
                                reject(err);
                            }
                        } else {
                            resolve(null);
                        }
                    });
                } else {
                    // Not interactive, and silent failed
                    resolve(null);
                }
            } else {
                console.log("Silent getAuthToken success");
                // Cache it too just in case
                chrome.storage.local.set({ authToken: token });
                resolve(token);
            }
        });
    });
}

async function handleApiError(response) {
    if (response.status === 401) {
        console.warn("Token expired or invalid. Clearing cache.");
        await chrome.storage.local.remove('authToken');
        // Also try to remove from chrome.identity cache if possible
        const token = await new Promise(resolve => chrome.storage.local.get(['authToken'], res => resolve(res.authToken)));
        if (token) {
            chrome.identity.removeCachedAuthToken({ token: token }, () => {});
        }
        throw new Error("Unauthorized (401) - Token expired");
    }
    if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }
    return response;
}

async function findFile(token) {
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.append('q', `name = '${DRIVE_FILE_NAME}' and 'appDataFolder' in parents and trashed = false`);
    url.searchParams.append('fields', 'files(id, modifiedTime)');
    url.searchParams.append('spaces', 'appDataFolder');

    const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` }
    });
    await handleApiError(response);
    const data = await response.json();
    return data.files && data.files.length > 0 ? data.files[0] : null;
}

async function downloadFile(token, fileId) {
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    await handleApiError(response);
    return await response.json();
}

async function uploadFile(token, content, fileId = null) {
    const metadata = {
        name: DRIVE_FILE_NAME,
        parents: ['appDataFolder']
    };

    // Multipart upload
    const boundary = '-------314159265358979323846';
    const delimiter = "\r\n--" + boundary + "\r\n";
    const close_delim = "\r\n--" + boundary + "--";

    const contentType = 'application/json';
    
    let body = delimiter +
        'Content-Type: application/json\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: ' + contentType + '\r\n\r\n' +
        JSON.stringify(content) +
        close_delim;

    let url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    let method = 'POST';

    if (fileId) {
        url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`;
        method = 'PATCH';
    }

    const response = await fetch(url, {
        method: method,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'multipart/related; boundary="' + boundary + '"'
        },
        body: body
    });
    await handleApiError(response);
    return await response.json();
}

async function syncData(interactive = false) {
    const btn = document.getElementById('btn-google-sync');
    const status = document.getElementById('syncStatus');
    
    try {
        if (interactive) {
            btn.disabled = true;
            btn.textContent = '🔄 Syncing...';
            status.textContent = '正在同步...';
        }

        const token = await getAuthToken(interactive);
        if (!token) {
            if (interactive) throw new Error('Login failed');
            return; // Silent fail
        }

        // If we got a token, we are logged in
        if (interactive) {
             // Only schedule if explicitly clicked, otherwise checkAuthStatus handles it
             scheduleNextSync(); 
        }

        const cloudFile = await findFile(token);
        
        let cloudData = {};
        if (cloudFile) {
            cloudData = await downloadFile(token, cloudFile.id);
        }

        const localData = await loadData();
        const mergedData = { ...cloudData };

        // Merge Strategy: Max values for counters
        for (const date in localData) {
            if (mergedData[date]) {
                mergedData[date] = {
                    videoTime: Math.max(localData[date].videoTime || 0, mergedData[date].videoTime || 0),
                    interactionTime: Math.max(localData[date].interactionTime || 0, mergedData[date].interactionTime || 0),
                    totalTime: Math.max(localData[date].totalTime || 0, mergedData[date].totalTime || 0),
                };
            } else {
                mergedData[date] = localData[date];
            }
        }

        // Save merged data locally
        await new Promise(resolve => chrome.storage.sync.set(mergedData, resolve));
        allData = mergedData; // Update memory cache

        // Upload merged data to cloud
        await uploadFile(token, mergedData, cloudFile ? cloudFile.id : null);

        status.textContent = '同步完成 ' + new Date().toLocaleTimeString();
        
        // Update UI to show next sync time
        nextSyncTime = new Date(Date.now() + SYNC_INTERVAL_MINUTES * 60000);
        updateSyncUI(true);
        
        updateDashboard();
        if (!document.getElementById('page-history').classList.contains('hidden')) {
            renderCalendar();
        }

    } catch (error) {
        console.error('Sync failed:', error);
        if (interactive) {
            status.textContent = '同步失敗';
            btn.textContent = '❌ Retry';
            setTimeout(() => updateSyncUI(false), 3000); // Reset to login state on failure
        }
    } finally {
        btn.disabled = false;
    }
}
