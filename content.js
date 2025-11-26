// content.js - 增強版監控腳本

const isMainFrame = (window === window.top);
const isYoutubeFrame = window.location.hostname.includes('youtube') || window.location.href.includes('youtube');

console.log(`[GST] Content script loaded. Main: ${isMainFrame}, YT: ${isYoutubeFrame}, URL: ${window.location.href}`);

// ==========================================
//  Part A: YouTube Iframe 深度整合
// ==========================================
if (isYoutubeFrame) {
    // 策略 1: DOM 事件監聽 (最通用)
    const setupVideoListener = () => {
        const video = document.querySelector('video');
        if (video && !video.dataset.gstTracked) {
            console.log("[GST] Video element detected in iframe.");
            video.dataset.gstTracked = "true";

            const report = (isPlaying) => {
                try {
                    // 嘗試使用 Runtime 訊息
                    chrome.runtime.sendMessage({ type: 'VIDEO_STATE_UPDATE', isPlaying });
                } catch (e) {
                    // 如果 Context 失效或被阻擋，不做處理，依賴 PostMessage
                }
                // 同時發送 PostMessage 给父窗口 (更可靠)
                window.parent.postMessage({ type: 'GST_VIDEO_UPDATE', isPlaying }, '*');
            };

            video.addEventListener('play', () => report(true));
            video.addEventListener('playing', () => report(true));
            video.addEventListener('pause', () => report(false));
            video.addEventListener('ended', () => report(false));
            video.addEventListener('waiting', () => report(false));
        }
    };

    // 策略 2: 輪詢檢查 (針對動態載入)
    setInterval(setupVideoListener, 1000);
}

// ==========================================
//  Part B: 主頁面邏輯
// ==========================================
if (isMainFrame) {
    
    // --- 狀態管理 ---
    let state = {
        today: new Date().toISOString().split('T')[0],
        isVideoPlaying: false,
        lastInteraction: Date.now(),
        
        // 暫存增量
        pendingVideo: 0,
        pendingInteraction: 0,
        pendingTotal: 0,

        // 顯示基數
        baseVideo: 0,
        baseInteraction: 0,
        baseTotal: 0
    };

    // --- 訊息接收 (Runtime & PostMessage) ---
    
    // 1. 來自 Iframe 的 Runtime 訊息
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'VIDEO_STATE_UPDATE') {
            console.log("[GST] State update via Runtime:", msg.isPlaying);
            state.isVideoPlaying = msg.isPlaying;
            if (state.isVideoPlaying) updateInteraction();
        }
        // 來自 Popup 的開關指令
        if (msg.type === 'TOGGLE_OVERLAY') {
            toggleOverlay(msg.show);
        }
    });

    // 2. 來自 Iframe 的 PostMessage (跨域備援)
    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'GST_VIDEO_UPDATE') {
            console.log("[GST] State update via PostMessage:", event.data.isPlaying);
            state.isVideoPlaying = event.data.isPlaying;
            if (state.isVideoPlaying) updateInteraction();
        }
    });

    // --- 互動監測 ---
    function updateInteraction() {
        state.lastInteraction = Date.now();
    }
    ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'].forEach(evt => {
        window.addEventListener(evt, updateInteraction, { passive: true });
    });

    // --- 懸浮視窗 UI (使用 Shadow DOM 隔離樣式) ---
    let overlayContainer = null;
    let overlayRoot = null;

    function createOverlay() {
        if (document.getElementById('gst-root')) return;

        const host = document.createElement('div');
        host.id = 'gst-root';
        host.style.cssText = 'position: fixed; top: 0; left: 0; z-index: 2147483647; width: 0; height: 0;';
        document.body.appendChild(host);

        const shadow = host.attachShadow({ mode: 'open' });
        overlayRoot = shadow;

        // 樣式
        const style = document.createElement('style');
        style.textContent = `
            .overlay {
                position: fixed;
                bottom: 20px;
                right: 20px;
                width: 220px;
                background: rgba(30, 30, 30, 0.95);
                color: #fff;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.5);
                font-family: 'Segoe UI', sans-serif;
                border: 1px solid #444;
                user-select: none;
                transition: opacity 0.3s;
            }
            .header {
                padding: 8px 12px;
                background: #333;
                border-top-left-radius: 8px;
                border-top-right-radius: 8px;
                cursor: move;
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 12px;
                color: #aaa;
            }
            .content {
                padding: 12px;
            }
            .row {
                display: flex;
                justify-content: space-between;
                margin-bottom: 6px;
                font-size: 14px;
            }
            .row:last-child { margin-bottom: 0; }
            .label { color: #ccc; }
            .value { font-family: monospace; font-weight: bold; }
            .video-val { color: #ff6b6b; }
            .active-val { color: #51cf66; }
            .total-val { color: #4dabf7; }
            .hidden { opacity: 0; pointer-events: none; }
            .handle { width: 100%; height: 100%; }
        `;
        shadow.appendChild(style);

        // 結構
        const wrapper = document.createElement('div');
        wrapper.className = 'overlay';
        wrapper.id = 'panel';
        wrapper.innerHTML = `
            <div class="header" id="dragHandle">
                <span>📊 學習監控</span>
                <span style="font-size:10px">::</span>
            </div>
            <div class="content">
                <div class="row">
                    <span class="label">🎥 播放</span>
                    <span class="value video-val" id="val-video">00:00:00</span>
                </div>
                <div class="row">
                    <span class="label">⚡ 專注</span>
                    <span class="value active-val" id="val-active">00:00:00</span>
                </div>
                <div class="row" style="margin-top:8px; padding-top:8px; border-top:1px solid #444">
                    <span class="label">⏳ 掛機</span>
                    <span class="value total-val" id="val-total">00:00:00</span>
                </div>
            </div>
        `;
        shadow.appendChild(wrapper);
        overlayContainer = wrapper;

        // 實作拖曳
        setupDraggable(wrapper, wrapper.querySelector('#dragHandle'));

        // 檢查預設顯示設定
        chrome.storage.local.get(['showOverlay'], (res) => {
            if (res.showOverlay === false) {
                wrapper.classList.add('hidden');
            }
        });
    }

    function toggleOverlay(show) {
        if (!overlayContainer) createOverlay();
        if (show) {
            overlayContainer.classList.remove('hidden');
        } else {
            overlayContainer.classList.add('hidden');
        }
    }

    function setupDraggable(el, handle) {
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        handle.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            
            const rect = el.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;

            // 移除 bottom/right 定位，改用 top/left
            el.style.bottom = 'auto';
            el.style.right = 'auto';
            el.style.left = `${initialLeft}px`;
            el.style.top = `${initialTop}px`;
            
            handle.style.cursor = 'grabbing';
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            el.style.left = `${initialLeft + dx}px`;
            el.style.top = `${initialTop + dy}px`;
        });

        window.addEventListener('mouseup', () => {
            isDragging = false;
            handle.style.cursor = 'move';
        });
    }

    function formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    // --- 計時迴圈 ---
    setInterval(() => {
        // 更新計數
        state.pendingTotal++;

        const now = Date.now();
        // 互動判定：影片播放中 OR 30秒內有動作
        if (state.isVideoPlaying || (now - state.lastInteraction < 30000)) {
            state.pendingInteraction++;
        }

        if (state.isVideoPlaying) {
            state.pendingVideo++;
        }

        // 更新 UI (如果有建立)
        if (overlayRoot) {
            const v = state.baseVideo + state.pendingVideo;
            const i = state.baseInteraction + state.pendingInteraction;
            const t = state.baseTotal + state.pendingTotal;
            
            overlayRoot.getElementById('val-video').textContent = formatTime(v);
            overlayRoot.getElementById('val-active').textContent = formatTime(i);
            overlayRoot.getElementById('val-total').textContent = formatTime(t);
        }

    }, 1000);

    // --- 同步機制 ---
    const SYNC_KEY = state.today;
    
    // 初始載入
    chrome.storage.sync.get([SYNC_KEY], (result) => {
        const data = result[SYNC_KEY] || { videoTime: 0, interactionTime: 0, totalTime: 0 };
        state.baseVideo = data.videoTime;
        state.baseInteraction = data.interactionTime;
        state.baseTotal = data.totalTime;
        createOverlay(); // 數據載入後再建立 UI
    });

    // 定期存檔
    setInterval(() => {
        if (state.pendingTotal === 0) return;

        chrome.storage.sync.get([SYNC_KEY], (result) => {
            const data = result[SYNC_KEY] || { videoTime: 0, interactionTime: 0, totalTime: 0 };
            
            data.videoTime += state.pendingVideo;
            data.interactionTime += state.pendingInteraction;
            data.totalTime += state.pendingTotal;

            chrome.storage.sync.set({ [SYNC_KEY]: data }, () => {
                state.baseVideo = data.videoTime;
                state.baseInteraction = data.interactionTime;
                state.baseTotal = data.totalTime;
                
                state.pendingVideo = 0;
                state.pendingInteraction = 0;
                state.pendingTotal = 0;
            });
        });
    }, 5000);
}
