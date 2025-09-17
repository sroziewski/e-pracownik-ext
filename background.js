/* JavaScript */
const TARGET_URL = "https://e-pracownik.opi.org.pl/#/home";
const ALARM_NAME = "autoCheckPresence";

// Generate unique session identifier for this service worker instance
const sessionId = `sw_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// Extension startup logging
console.log(`[DEBUG_LOG] e-Pracownik Extension Starting Up
Extension ID: ${chrome.runtime.id}
Extension Version: ${chrome.runtime.getManifest().version}
Platform: ${navigator.platform}
Timestamp: ${new Date().toISOString()}
Service Worker Session: ${sessionId}`);

// Store active click sessions to correlate with HTTP requests
let activeClickSessions = new Map();

async function openTargetAndRunCheck(clickSessionId = null) {
    const processId = `check_${Date.now()}`;

    console.log(`[DEBUG_LOG] Starting presence check process
Process ID: ${processId}
Click Session ID: ${clickSessionId || 'AUTO_SCHEDULED'}
Target URL: ${TARGET_URL}
Timestamp: ${new Date().toISOString()}`);

    // Store the session for HTTP request correlation
    if (clickSessionId) {
        activeClickSessions.set(clickSessionId, {
            processId: processId,
            startTime: new Date().toISOString(),
            status: 'PROCESSING' // Initial state
        });
    }

    try {
        const existingTabs = await chrome.tabs.query({ url: "https://e-pracownik.opi.org.pl/*" });
        let tab;
        if (existingTabs.length > 0) {
            tab = await chrome.tabs.update(existingTabs[0].id, { url: TARGET_URL, active: false });
            console.log(`[DEBUG_LOG] REUSING EXISTING TAB: ${tab.id}`);
        } else {
            tab = await chrome.tabs.create({ url: TARGET_URL, active: false });
            console.log(`[DEBUG_LOG] CREATED NEW TAB: ${tab.id}`);
        }

        if (clickSessionId) {
            activeClickSessions.set(clickSessionId, {
                ...activeClickSessions.get(clickSessionId),
                tabId: tab.id,
            });
        }
    } catch (error) {
        console.log(`[DEBUG_LOG] Tab management error: ${error.message}`);
    }
}

// Messages from popup/options and content scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "RUN_CHECK_NOW") {
        const clickSessionId = msg.clickSessionId;
        console.log(`[DEBUG_LOG] RUN_CHECK_NOW message received. Session ID: ${clickSessionId}`);
        openTargetAndRunCheck(clickSessionId);
        sendResponse({ ok: true, status: 'INITIATED' });
        return true;
    }

    if (msg?.type === "CONTENT_SCRIPT_READY") {
        const tabId = sender.tab.id;
        console.log(`[DEBUG_LOG] CONTENT_SCRIPT_READY received from tab ${tabId}`);

        for (const [sessionId, sessionData] of activeClickSessions.entries()) {
            // Check if this tab is part of a session that is waiting for an action
            if (sessionData.tabId === tabId && (sessionData.status === 'PROCESSING' || sessionData.status === 'AWAITING_HOME_LOAD')) {
                console.log(`[DEBUG_LOG] Handshake successful for session ${sessionId}. Sending CHECK_IN to tab ${tabId}.`);

                // Update state to show we've sent the command
                activeClickSessions.set(sessionId, { ...sessionData, status: 'IN_PROGRESS' });

                chrome.tabs.sendMessage(tabId, {
                    type: "CHECK_IN",
                    clickSessionId: sessionId,
                    processId: sessionData.processId,
                    tabId: tabId
                });
                break;
            }
        }
        // No response needed
    }

    if (msg?.type === "LOGIN_SUCCESSFUL") {
        const { clickSessionId } = msg;
        if (sender.tab && sender.tab.id && clickSessionId) {
            const sessionData = activeClickSessions.get(clickSessionId);
            if (sessionData) {
                // Set state to wait for the home page to load
                activeClickSessions.set(clickSessionId, { ...sessionData, status: 'AWAITING_HOME_LOAD' });
                console.log(`[DEBUG_LOG] Session ${clickSessionId} state changed to AWAITING_HOME_LOAD. Navigating tab...`);
                // Navigate to the home page
                chrome.tabs.update(sender.tab.id, { url: TARGET_URL });
            }
        }
        // No response needed
    }

    if (msg?.type === "PRESENCE_CHECK_COMPLETE") {
        const { success, tabId, clickSessionId } = msg;
        console.log(`[DEBUG_LOG] PRESENCE_CHECK_COMPLETE received. Success: ${success}`);
        if (success && tabId) {
            setTimeout(() => {
                chrome.tabs.remove(tabId).catch(e => console.log(`Tab cleanup error: ${e.message}`));
            }, 2000);
        }
        // Clean up the session regardless of success
        if (clickSessionId) activeClickSessions.delete(clickSessionId);
        sendResponse({ ok: true });
        return true;
    }

    if (msg?.type === "PROXY_FETCH") {
        const { url, options } = msg.payload;
        fetch(url, options)
            .then(response => response.text().then(text => ({ status: response.status, statusText: response.statusText, data: text })))
            .then(result => sendResponse({ ok: true, response: result }))
            .catch(error => sendResponse({ ok: false, error: error.message }));
        return true; // REQUIRED for async sendResponse
    }
});
