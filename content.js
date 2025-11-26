// content.js - 背景執行增強版

const isMainFrame = (window === window.top);
const isYoutubeFrame = window.location.hostname.includes('youtube') || window.location.href.includes('youtube');

console.log(`[GST] Content script loaded. Main: ${isMainFrame}, YT: ${isYoutubeFrame}, URL: ${window.location.href}`);

// ==========================================
//  Part A: YouTube Iframe 邏輯
// ==========================================
if (isYoutubeFrame) {
    const setupVideoListener = () => {
        const video = document.querySelector('video');
        if (video && !video.dataset.gstTracked) {
            console.log("[GST] Video detected in iframe.");
            video.dataset.gstTracked = "true";

            const report = () => {
                const isPlaying = !video.paused && !video.ended && video.readyState > 2;
                // 使用 PostMessage 確保跨域通訊
                window.parent.postMessage({ type: 'GST_VIDEO_UPDATE', isPlaying }, '*');
                
                try { chrome.runtime.sendMessage({ type: 'VIDEO_STATE_UPDATE', isPlaying }); } catch(e){}
            };

            // 事件監聽
            ['play', 'playing', 'pause', 'ended', 'waiting'].forEach(evt => {
                video.addEventListener(evt, report);
            });

            // 心跳機制：確保背景播放時也能持續更新狀態 (每秒回報)
            setInterval(report, 1000);
        }
    };

    setInterval(setupVideoListener, 2000);
}

// ==========================================
//  Part B: 主頁面邏輯 (計時核心)
// ==========================================
if (isMainFrame) {
    
    // --- 狀態管理 ---
    let state = {
        today: new Date().toISOString().split('T')[0],
        isVideoPlaying: false,
        lastInteraction: Date.now(),
        lastTick: Date.now(), // 用於計算時間差 (Delta)
        
        pendingVideo: 0,
        pendingInteraction: 0,
        pendingTotal: 0,

        baseVideo: 0,
        baseInteraction: 0,
        baseTotal: 0
    };

    // --- 訊息接收 ---
    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'GST_VIDEO_UPDATE') {
            // 只有狀態改變時才 log，避免洗版
            if (state.isVideoPlaying !== event.data.isPlaying) {
                console.log("[GST] Video state changed:", event.data.isPlaying);
            }
            state.isVideoPlaying = event.data.isPlaying;
            
            // 如果影片在播放，視為持續互動，更新最後互動時間
            if (state.isVideoPlaying) {
                state.lastInteraction = Date.now();
            }
        }
    });

    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'VIDEO_STATE_UPDATE') state.isVideoPlaying = msg.isPlaying;
        if (msg.type === 'TOGGLE_OVERLAY') toggleOverlay(msg.show);
    });

    // --- 互動監測 ---
    function updateInteraction() {
        state.lastInteraction = Date.now();
    }
    ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'].forEach(evt => {
        window.addEventListener(evt, updateInteraction, { passive: true });
    });

    // --- 計時核心 (Delta Time 機制) ---
    // 使用 setInterval 作為觸發器，但不依賴它準時執行
    setInterval(() => {
        const now = Date.now();
        const delta = (now - state.lastTick) / 1000; // 算出距離上次執行經過了幾秒 (浮點數)
        state.lastTick = now;

        // 忽略異常大的跳躍 (例如休眠喚醒後)，或過小的抖動
        if (delta <= 0) return;
        if (delta > 300) { // 如果超過 5 分鐘沒執行，可能是電腦休眠，不計入這段時間
             console.log("[GST] System sleep detected, skipping time.");
             return;
        }

        // 1. 總掛機時間 (只要網頁開著就算)
        state.pendingTotal += delta;

        // 2. 互動時間判定
        // 條件: 影片正在播放 OR (目前時間 - 最後互動時間 < 30秒)
        const timeSinceInteraction = now - state.lastInteraction;
        if (state.isVideoPlaying || timeSinceInteraction < 30000) {
            state.pendingInteraction += delta;
        }

        // 3. 影片時間
        if (state.isVideoPlaying) {
            state.pendingVideo += delta;
        }

        // 更新 UI
        updateOverlay();

    }, 1000);

    // --- 懸浮視窗 UI ---
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
            .content { padding: 12px; }
            .row { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 14px; }
            .row:last-child { margin-bottom: 0; }
            .label { color: #ccc; }
            .value { font-family: monospace; font-weight: bold; }
            .video-val { color: #ff6b6b; }
            .active-val { color: #51cf66; }
            .total-val { color: #4dabf7; }
            .hidden { opacity: 0; pointer-events: none; }
        `;
        shadow.appendChild(style);

        const wrapper = document.createElement('div');
        wrapper.className = 'overlay';
        wrapper.id = 'panel';
        wrapper.innerHTML = `
            <div class="header" id="dragHandle"><span>📊 學習監控</span><span style="font-size:10px">::</span></div>
            <div class="content">
                <div class="row"><span class="label">🎥 播放</span><span class="value video-val" id="val-video">00:00:00</span></div>
                <div class="row"><span class="label">⚡ 專注</span><span class="value active-val" id="val-active">00:00:00</span></div>
                <div class="row" style="margin-top:8px; padding-top:8px; border-top:1px solid #444"><span class="label">⏳ 掛機</span><span class="value total-val" id="val-total">00:00:00</span></div>
            </div>
        `;
        shadow.appendChild(wrapper);
        overlayContainer = wrapper;
        setupDraggable(wrapper, wrapper.querySelector('#dragHandle'));

        chrome.storage.local.get(['showOverlay'], (res) => {
            if (res.showOverlay === false) wrapper.classList.add('hidden');
        });
    }

    function toggleOverlay(show) {
        if (!overlayContainer) createOverlay();
        overlayContainer.classList.toggle('hidden', !show);
    }

    function setupDraggable(el, handle) {
        let isDragging = false, startX, startY, initialLeft, initialTop;
        handle.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = el.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;
            el.style.bottom = 'auto'; el.style.right = 'auto';
            el.style.left = `${initialLeft}px`; el.style.top = `${initialTop}px`;
            handle.style.cursor = 'grabbing';
        });
        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            el.style.left = `${initialLeft + (e.clientX - startX)}px`;
            el.style.top = `${initialTop + (e.clientY - startY)}px`;
        });
        window.addEventListener('mouseup', () => { isDragging = false; handle.style.cursor = 'move'; });
    }

    function formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60); // 確保顯示整數
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    function updateOverlay() {
        if (overlayRoot) {
            // 取整數顯示
            const v = Math.floor(state.baseVideo + state.pendingVideo);
            const i = Math.floor(state.baseInteraction + state.pendingInteraction);
            const t = Math.floor(state.baseTotal + state.pendingTotal);
            
            overlayRoot.getElementById('val-video').textContent = formatTime(v);
            overlayRoot.getElementById('val-active').textContent = formatTime(i);
            overlayRoot.getElementById('val-total').textContent = formatTime(t);
        }
    }

    // --- 同步機制 ---
    const SYNC_KEY = state.today;
    
    chrome.storage.sync.get([SYNC_KEY], (result) => {
        const data = result[SYNC_KEY] || { videoTime: 0, interactionTime: 0, totalTime: 0 };
        state.baseVideo = data.videoTime;
        state.baseInteraction = data.interactionTime;
        state.baseTotal = data.totalTime;
        createOverlay();
    });

    // 定期存檔 (5秒)
    setInterval(() => {
        if (state.pendingTotal < 0.1) return; // 改用浮點數判斷

        chrome.storage.sync.get([SYNC_KEY], (result) => {
            const data = result[SYNC_KEY] || { videoTime: 0, interactionTime: 0, totalTime: 0 };
            
            // 累加並保留小數點以確保精確度，但在顯示時取整
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