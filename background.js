/* JavaScript */
const TARGET_URL = "https://e-pracownik.opi.org.pl/#/home";

console.log(`[DEBUG_LOG] Extension loaded at ${new Date().toISOString()}`);

// This function opens or focuses the tab.
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
    // From popup.js
    if (msg.type === "RUN_CHECK_NOW") {
        console.log("[DEBUG_LOG] RUN_CHECK_NOW message received from popup.");
        startOrFocusTab();
        sendResponse({ status: "Process initiated" });
        return;
    }

    // From contentScript.js, after a successful login
    if (msg.type === "LOGIN_SUCCESSFUL") {
        console.log(`[DEBUG_LOG] Received LOGIN_SUCCESSFUL from tab ${sender.tab.id}. Forcing navigation to home.`);
        // Use the authoritative tabs API to navigate the tab. This will break the loop.
        chrome.tabs.update(sender.tab.id, { url: TARGET_URL });
        return;
    }

    // From contentScript.js, to make API calls
    if (msg.type === "PROXY_FETCH") {
        fetch(msg.payload.url, msg.payload.options)
            .then(response => {
                // We need to handle non-ok responses so the content script knows about them.
                if (!response.ok) {
                    // Don't throw an error, just pass the status along
                    return { status: response.status, data: null };
                }
                return response.text().then(text => ({ status: response.status, data: text }));
            })
            .then(result => sendResponse({ ok: true, response: result }))
            .catch(error => sendResponse({ ok: false, error: error.message }));
        return true; // Essential for async fetch
    }
});
