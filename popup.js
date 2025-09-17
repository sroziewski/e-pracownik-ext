/* JavaScript */
const notifyEl = document.getElementById("notify");
const enableAutoEl = document.getElementById("enableAuto");
const autoTimeEl = document.getElementById("autoTime");
const openOptionsLink = document.getElementById("openOptions");

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

openOptionsLink.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
});

function saveAndSchedule() {
    const enabled = enableAutoEl.checked;
    const timeParts = autoTimeEl.value.split(':');
    const hour = parseInt(timeParts[0], 10);
    const minute = parseInt(timeParts[1], 10);

    chrome.storage.local.set({
        notify: notifyEl.checked,
        enableAuto: enabled,
        autoTime: autoTimeEl.value
    });

    chrome.runtime.sendMessage({
        type: "SCHEDULE_ALARM",
        payload: { hour, minute, enabled }
    });
}

async function loadPreferences() {
    const result = await chrome.storage.local.get(["notify", "enableAuto", "autoTime"]);
    notifyEl.checked = result.notify || false;
    enableAutoEl.checked = result.enableAuto || false;
    autoTimeEl.value = result.autoTime || "08:05";
    autoTimeEl.disabled = !result.enableAuto;
}

notifyEl.addEventListener('change', saveAndSchedule);
enableAutoEl.addEventListener('change', () => {
    autoTimeEl.disabled = !enableAutoEl.checked;
    saveAndSchedule();
});
autoTimeEl.addEventListener('change', saveAndSchedule);

loadPreferences();
