/* JavaScript */
const TARGET_URL = "https://e-pracownik.opi.org.pl/#/home";

console.log(`[DEBUG_LOG] Extension loaded at ${new Date().toISOString()}`);

// This function contains the logic to open or focus the tab.
async function startOrFocusTab() {
    console.log("[DEBUG_LOG] Executing startOrFocusTab.");
    try {
        const tabs = await chrome.tabs.query({ url: "https://e-pracownik.opi.org.pl/*" });
        if (tabs.length > 0) {
            console.log(`[DEBUG_LOG] Found existing tab ${tabs[0].id}. Focusing and updating.`);
            await chrome.tabs.update(tabs[0].id, { url: TARGET_URL, active: true });
        } else {
            console.log("[DEBUG_LOG] No existing tab found. Creating a new one.");
            await chrome.tabs.create({ url: TARGET_URL });
        }
    } catch (error) {
        console.error("[DEBUG_LOG] Error in startOrFocusTab:", error);
    }
}

// Main listener for all messages.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "RUN_CHECK_NOW") {
        console.log("[DEBUG_LOG] RUN_CHECK_NOW message received from popup.");
        startOrFocusTab();
        sendResponse({ status: "Process initiated" });
        return;
    }

    if (msg.type === "PROXY_FETCH") {
        fetch(msg.payload.url, msg.payload.options)
            .then(response => {
                if (!response.ok) { throw new Error(`HTTP error! status: ${response.status}`); }
                return response.text().then(text => ({ status: response.status, data: text }));
            })
            .then(result => sendResponse({ ok: true, response: result }))
            .catch(error => sendResponse({ ok: false, error: error.message }));
        return true; // Essential for async fetch
    }
});
