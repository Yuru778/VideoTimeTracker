// content.js - 增強版監控腳本

const isMainFrame = (window === window.top);
const isYoutubeFrame = window.location.hostname.includes('youtube') || window.location.href.includes('youtube');

console.log(`[GST] Content script loaded. Main: ${isMainFrame}, YT: ${isYoutubeFrame}, URL: ${window.location.href}`);

// ==========================================
//  Part A: YouTube Iframe 深度整合
// ==========================================
if (isYoutubeFrame) {
    // [Security Fix] 僅當 Referrer 為 skills.google 時才啟動監測
    if (!document.referrer.includes('skills.google')) {
        // Do nothing
    } else {
        const setupVideoListener = () => {
            const video = document.querySelector('video');
            if (video && !video.dataset.gstTracked) {
                video.dataset.gstTracked = "true";
                const report = (isPlaying) => {
                    try { chrome.runtime.sendMessage({ type: 'VIDEO_STATE_UPDATE', isPlaying }); } catch (e) {}
                    window.parent.postMessage({ type: 'GST_VIDEO_UPDATE', isPlaying }, '*');
                };
                ['play', 'playing', 'pause', 'ended', 'waiting'].forEach(evt => {
                    video.addEventListener(evt, () => report(!video.paused && !video.ended && video.readyState > 2));
                });
            }
        };
        setInterval(setupVideoListener, 1000);
    }
}

// ==========================================
//  Part B: 主頁面邏輯
// ==========================================
if (isMainFrame) {
    // [Location Fix] 確保只在 skills.google 執行主邏輯
    if (!window.location.hostname.includes('skills.google')) {
        console.log("[GST] Main logic skipped for non-skills domain.");
    } else {
        
        // --- 狀態管理 ---
        let state = {
            today: new Date().toISOString().split('T')[0],
            isVideoPlaying: false,
            lastInteraction: Date.now(),
            lastTick: Date.now(),
            
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
                state.isVideoPlaying = event.data.isPlaying;
                if (state.isVideoPlaying) state.lastInteraction = Date.now();
            }
        });

        chrome.runtime.onMessage.addListener((msg) => {
            if (msg.type === 'VIDEO_STATE_UPDATE') state.isVideoPlaying = msg.isPlaying;
            if (msg.type === 'TOGGLE_OVERLAY') toggleOverlay(msg.show);
        });

        // --- 互動監測 ---
        function updateInteraction() { state.lastInteraction = Date.now(); }
        ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'].forEach(evt => {
            window.addEventListener(evt, updateInteraction, { passive: true });
        });

        // --- 計時核心 ---
        setInterval(() => {
            const now = Date.now();
            const delta = (now - state.lastTick) / 1000;
            state.lastTick = now;

            if (delta <= 0 || delta > 300) return; // 忽略異常

            state.pendingTotal += delta;
            if (state.isVideoPlaying || (now - state.lastInteraction < 30000)) {
                state.pendingInteraction += delta;
            }
            if (state.isVideoPlaying) {
                state.pendingVideo += delta;
            }
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
            
            // [Config] 讀取位置與顯示設定
            chrome.storage.local.get(['showOverlay', 'overlayPos'], (res) => {
                // 顯示開關
                if (res.showOverlay === false) wrapper.classList.add('hidden');
                
                // 位置記憶
                if (res.overlayPos) {
                    wrapper.style.left = res.overlayPos.left;
                    wrapper.style.top = res.overlayPos.top;
                    wrapper.style.bottom = 'auto';
                    wrapper.style.right = 'auto';
                } else {
                    // 預設位置
                    wrapper.style.bottom = '20px';
                    wrapper.style.right = '20px';
                }
            });

            setupDraggable(wrapper, wrapper.querySelector('#dragHandle'));
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
            window.addEventListener('mouseup', () => {
                if (isDragging) {
                    isDragging = false;
                    handle.style.cursor = 'move';
                    // [Save] 拖曳結束後儲存位置
                    chrome.storage.local.set({
                        overlayPos: {
                            left: el.style.left,
                            top: el.style.top
                        }
                    });
                }
            });
        }

        function formatTime(seconds) {
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            const s = Math.floor(seconds % 60);
            return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }

        function updateOverlay() {
            if (overlayRoot) {
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

        setInterval(() => {
            if (state.pendingTotal < 0.1) return;
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
}
