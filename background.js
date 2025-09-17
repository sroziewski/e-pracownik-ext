/* JavaScript */
const TARGET_URL = "https://e-pracownik.opi.org.pl/#/home";
const ALARM_NAME = "autoCheckPresence";

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
    } catch (error)
    {
        console.error("[DEBUG_LOG] Error in startOrFocusTab:", error);
    }
}


// =================== UPDATED ALARM LISTENER ===================
// This now logs the time and timezone when the alarm fires.
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
        const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        console.log(`[DEBUG_LOG] AUTO-CHECK ALARM FIRED
Current Time: ${new Date().toLocaleString()}
Timezone: ${userTimezone}
Action: Starting presence check.`);
        startOrFocusTab();
    }
});
// =============================================================


// Main listener for all messages.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "RUN_CHECK_NOW") {
        console.log("[DEBUG_LOG] RUN_CHECK_NOW message received from popup.");
        startOrFocusTab();
        sendResponse({ status: "Process initiated" });
        return;
    }

    if (msg.type === "LOGIN_SUCCESSFUL_PLEASE_NAVIGATE") {
        console.log(`[DEBUG_LOG] Received navigation request from tab ${sender.tab.id}. Navigating to home.`);
        chrome.tabs.update(sender.tab.id, { url: TARGET_URL });
        return;
    }

    if (msg.type === "PROXY_FETCH") {
        fetch(msg.payload.url, msg.payload.options)
            .then(response => {
                if (!response.ok) {
                    return response.text().then(text => {
                        throw new Error(`HTTP error! status: ${response.status}, body: ${text}`);
                    });
                }
                return response.text().then(text => ({ status: response.status, data: text }));
            })
            .then(result => sendResponse({ ok: true, response: result }))
            .catch(error => sendResponse({ ok: false, error: error.message }));
        return true;
    }

    if (msg.type === "SHOW_NOTIFICATION") {
        chrome.notifications.create({
            type: "basic",
            iconUrl: "icons/icon128.png",
            title: msg.payload.title || "e-Pracownik",
            message: msg.payload.message || "An update occurred."
        });
        return;
    }

    // =================== UPDATED SCHEDULER ===================
    // This now logs the time and timezone when an alarm is set.
    if (msg.type === "SCHEDULE_ALARM") {
        const { hour, minute, enabled } = msg.payload;
        chrome.alarms.clear(ALARM_NAME, () => {
            if (enabled) {
                const now = new Date();
                const next = new Date();
                next.setHours(hour, minute, 0, 0);

                if (next <= now) {
                    next.setDate(next.getDate() + 1);
                }

                const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

                console.log(`[DEBUG_LOG] SCHEDULING ALARM
Setting for: ${hour}:${minute.toString().padStart(2, '0')}
Next Run Time: ${next.toLocaleString()}
User Timezone: ${userTimezone}`);

                chrome.alarms.create(ALARM_NAME, {
                    when: next.getTime(),
                    periodInMinutes: 24 * 60 // Daily
                });
            } else {
                console.log("[DEBUG_LOG] Alarm disabled and cleared.");
            }
            sendResponse({ ok: true });
        });
        return true; // async response
    }
    // =============================================================
});
