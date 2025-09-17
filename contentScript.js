const TARGET_URL = "https://e-pracownik.opi.org.pl/#/home";

console.log(`[DEBUG_LOG] Content script loaded. URL: ${location.href}`);

const selectors = {
    login: {
        username: "input[name='loginInput']",
        password: "input[name='passwordInput']",
        submit: "button[type='submit']"
    },
    rcpCard: "app-rcp-card",
    presenceStatus: ".rcp-time-tracking-card-status-label--present",
    addButton: "button.add-button[mat-fab]",
    contextMenu: "div.mat-mdc-menu-panel",
    obecnoscMenuItem: "button.mat-mdc-menu-item",
    presenceButton: "div.smart-button.smart-button-add"
};

const textMatchers = {
    markPresence: /rozpocznij/i,
    obecnosc: /^obecność$/i,
    dzisiajLabel: /dzisiaj/i
};

function isOnLoginPage() { return location.href.includes("/auth/login"); }
function isOnHomePage() { return location.href.includes("/#/home"); }

async function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

function findByText(root, selector, regex) {
    for (const el of root.querySelectorAll(selector)) {
        if (regex.test(el.innerText || el.textContent)) return el;
    }
    return null;
}

async function waitForElement(selector, timeout = 8000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
        const element = document.querySelector(selector);
        if (element) return element;
        await sleep(250);
    }
    return null;
}

// =================== NEW ROBUST WAITING FUNCTION ===================
async function waitForContent(textRegex, timeout = 10000) {
    console.log(`[DEBUG_LOG] Actively polling for content: "${textRegex}" for up to ${timeout}ms...`);
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
        const element = findByText(document.body, 'span, div', textRegex);
        if (element) {
            console.log("[DEBUG_LOG] Content found!");
            return element;
        }
        await sleep(500); // Check every half second
    }
    console.error("[DEBUG_LOG] Timed out waiting for content.");
    return null;
}
// =================================================================


function fillInput(element, value) {
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
}

async function proxyFetch(url, options = {}) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'PROXY_FETCH', payload: { url, options } }, response => {
            if (chrome.runtime.lastError || !response) {
                reject(new Error(chrome.runtime.lastError?.message || "Proxy fetch failed: No response."));
            } else if (!response.ok) {
                const err = new Error(response.error || `HTTP error! status: ${response.response?.status}`);
                reject(err);
            } else {
                resolve(response.response);
            }
        });
    });
}

async function checkSessionStatus() {
    console.log("[DEBUG_LOG] Checking session status via API...");
    try {
        const res = await proxyFetch('https://e-pracownik.opi.org.pl:9901/api/calendar/configuration/schedule/default');
        return res.status === 200;
    } catch (e) {
        console.error(`[DEBUG_LOG] Session check failed. ${e.message}`);
        return false;
    }
}

async function performUILogin() {
    console.log("[DEBUG_LOG] Attempting UI-based login...");
    const creds = await chrome.storage.local.get(["username", "password"]);
    if (!creds.username || !creds.password) {
        return false;
    }
    const usernameField = await waitForElement(selectors.login.username);
    const passwordField = await waitForElement(selectors.login.password);
    const submitButton = await waitForElement(selectors.login.submit);
    if (!usernameField || !passwordField || !submitButton) {
        return false;
    }
    fillInput(usernameField, creds.username);
    fillInput(passwordField, creds.password);
    await sleep(500);
    submitButton.click();
    return true;
}

async function clickButton() {
    console.log("[DEBUG_LOG] On home page. Waiting for dashboard to appear...");

    // Use the new robust waiting function
    const dzisiajLabel = await waitForContent(textMatchers.dzisiajLabel);
    if (!dzisiajLabel) {
        return { success: false, reason: "Button not found (Dashboard did not load)." };
    }

    const rcpCard = dzisiajLabel.closest('app-rcp-card');
    if (!rcpCard) {
        return { success: false, reason: "Button not found (RCP card missing)." };
    }

    console.log("[DEBUG_LOG] Dashboard content detected.");

    if (rcpCard.querySelector(selectors.presenceStatus)) {
        return { success: true, reason: "Presence Logged (Skipped - Already Present)." };
    }

    let btn = rcpCard.querySelector(selectors.presenceButton) || rcpCard.querySelector(selectors.addButton);

    if (!btn) {
        return { success: true, reason: "Presence Login Skipped (Button not present)." };
    }

    console.log("[DEBUG_LOG] Button found. Clicking.", btn);
    btn.click();
    await sleep(500);

    const menuPanel = document.querySelector(selectors.contextMenu);
    if (menuPanel) {
        const menuItem = findByText(menuPanel, selectors.obecnoscMenuItem, textMatchers.obecnosc);
        if (menuItem) {
            menuItem.click();
        } else {
            return { success: false, reason: "Button not found ('Obecność' missing from menu)." };
        }
    }

    await sleep(2000);

    if (document.querySelector(selectors.presenceStatus)) {
        return { success: true, reason: "Presence Logged (Successfully marked)." };
    } else {
        return { success: false, reason: "Action failed (Clicked but not confirmed)." };
    }
}


async function main() {
    console.log(`[DEBUG_LOG] Main logic starting on: ${location.href}`);
    const prefs = await chrome.storage.local.get(["notify", "enableAuto"]);
    console.log(`[DEBUG_LOG] Preferences - Notify: ${!!prefs.notify}, Auto-Check: ${!!prefs.enableAuto}`);

    let finalStatus = { success: false, reason: "An unknown error occurred." };

    const isLoggedIn = await checkSessionStatus();

    if (isLoggedIn) {
        if (isOnHomePage()) {
            finalStatus = await clickButton();
        } else {
            finalStatus = { success: false, reason: "Logged in, but not on home page." };
            window.location.href = TARGET_URL;
            return;
        }
    } else {
        if (isOnLoginPage()) {
            const loginSuccess = await performUILogin();
            if (!loginSuccess) {
                finalStatus = { success: false, reason: "Login failed. Halting." };
            } else {
                return;
            }
        } else {
            finalStatus = { success: false, reason: "Not logged in. Redirecting to login."};
            window.location.href = "https://e-pracownik.opi.org.pl/#/auth/login";
            return;
        }
    }

    if (prefs.notify) {
        console.log(`[DEBUG_LOG] Sending notification: ${finalStatus.reason}`);
        chrome.runtime.sendMessage({
            type: "SHOW_NOTIFICATION",
            payload: {
                title: finalStatus.success ? "e-Pracownik Success" : "e-Pracownik Action Needed",
                message: finalStatus.reason
            }
        });
    }
}

main();
