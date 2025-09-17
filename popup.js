/* JavaScript */
const notifyEl = document.getElementById("notify");
const enableAutoEl = document.getElementById("enableAuto");
const autoTimeEl = document.getElementById("autoTime");
const openOptionsLink = document.getElementById("openOptions");

// 1. Logic for "Check presence now" button (Kept from previous successful versions)
document.getElementById("checkNowBtn").addEventListener("click", () => {
    console.log("[DEBUG_LOG] USER BUTTON CLICK INITIATED");

    chrome.runtime.sendMessage({ type: "RUN_CHECK_NOW" }, (response) => {
        if (chrome.runtime.lastError) {
            console.error("Error sending message:", chrome.runtime.lastError);
            return;
        }
        console.log("[DEBUG_LOG] Message sent. Background response:", response);
    });

    window.close();
});

// 2. FIX: Logic for "Open Options" link
openOptionsLink.addEventListener("click", (e) => {
    e.preventDefault(); // Prevents the page from jumping to '#'
    chrome.runtime.openOptionsPage(); // Opens the options.html page
});

// 3. Logic to Save Preferences and Schedule Alarm
function saveAndSchedule() {
    const enabled = enableAutoEl.checked;
    const timeParts = autoTimeEl.value.split(':');
    const hour = parseInt(timeParts[0], 10);
    const minute = parseInt(timeParts[1], 10);

    // Save preferences to storage
    chrome.storage.local.set({
        notify: notifyEl.checked,
        enableAuto: enabled,
        autoTime: autoTimeEl.value
    });

    // Send scheduling instruction to background.js
    chrome.runtime.sendMessage({
        type: "SCHEDULE_ALARM",
        payload: { hour, minute, enabled }
    });
}

// 4. Logic to Load Preferences
async function loadPreferences() {
    const result = await chrome.storage.local.get(["notify", "enableAuto", "autoTime"]);

    // Load values into UI
    notifyEl.checked = result.notify || false;
    enableAutoEl.checked = result.enableAuto || false;
    autoTimeEl.value = result.autoTime || "08:05";

    // Set initial state of the time input (disabled if auto-check is off)
    autoTimeEl.disabled = !result.enableAuto;
}

// Add listeners for immediate saving on change
notifyEl.addEventListener('change', saveAndSchedule);
enableAutoEl.addEventListener('change', () => {
    // Toggle time input state based on checkbox
    autoTimeEl.disabled = !enableAutoEl.checked;
    saveAndSchedule();
});
autoTimeEl.addEventListener('change', saveAndSchedule);

// Initialize UI
loadPreferences();
