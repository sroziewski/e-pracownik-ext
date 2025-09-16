/* JavaScript */
const statusEl = document.getElementById("status");
const checkNowBtn = document.getElementById("checkNowBtn");
const notifyCb = document.getElementById("notify");
const enableAutoCb = document.getElementById("enableAuto");
const autoTimeInput = document.getElementById("autoTime");
const openOptions = document.getElementById("openOptions");

function setStatus(text) {
  statusEl.textContent = text;
}

async function init() {
  const { notify, autoEnabled, autoHour, autoMinute } = await chrome.storage.local.get(["notify", "autoEnabled", "autoHour", "autoMinute"]);
  notifyCb.checked = !!notify;
  enableAutoCb.checked = !!autoEnabled;
  if (typeof autoHour === "number" && typeof autoMinute === "number") {
    const hh = String(autoHour).padStart(2, "0");
    const mm = String(autoMinute).padStart(2, "0");
    autoTimeInput.value = `${hh}:${mm}`;
  }

  notifyCb.addEventListener("change", () => {
    chrome.storage.local.set({ notify: notifyCb.checked });
  });

  enableAutoCb.addEventListener("change", () => {
    scheduleAlarm();
    chrome.storage.local.set({ autoEnabled: enableAutoCb.checked });
  });

  autoTimeInput.addEventListener("change", () => {
    scheduleAlarm();
  });

  openOptions.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  checkNowBtn.addEventListener("click", () => {
    // Generate unique session ID for this button click to track associated HTTP requests
    const clickSessionId = `click_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    console.log(`[DEBUG_LOG] USER BUTTON CLICK INITIATED
Button ID: checkNowBtn
User Action: Manual presence check
Click Session ID: ${clickSessionId}
Timestamp: ${new Date().toISOString()}
Process: Sending RUN_CHECK_NOW message to background script`);
    
    setStatus("Opening site and checking...");
    chrome.runtime.sendMessage({ 
      type: "RUN_CHECK_NOW",
      clickSessionId: clickSessionId 
    }, () => {
      console.log(`[DEBUG_LOG] RUN_CHECK_NOW message sent successfully
Click Session ID: ${clickSessionId}
Response received from background script
Timestamp: ${new Date().toISOString()}
Status: Message transmission completed - awaiting HTTP request results`);
      setStatus("Triggered. Result will be shown if notifications are enabled.");
    });
  });
}

function scheduleAlarm() {
  const enabled = enableAutoCb.checked;
  const [hStr, mStr] = autoTimeInput.value.split(":");
  const hour = parseInt(hStr, 10);
  const minute = parseInt(mStr, 10);
  chrome.storage.local.set({ autoHour: hour, autoMinute: minute, autoEnabled: enabled });
  chrome.runtime.sendMessage({
    type: "SCHEDULE_ALARM",
    payload: { hour, minute, enabled }
  });
}

init();
