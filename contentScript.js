/* JavaScript */
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

function fillInput(element, value) {
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
}


// =================== MISSING FUNCTIONS RESTORED HERE ===================
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

async function performLogin() {
    console.log("[DEBUG_LOG] Attempting API login...");
    const creds = await chrome.storage.local.get(["username", "password"]);
    if (!creds.username) {
        console.error("[DEBUG_LOG] Credentials not found in storage.");
        return false;
    }
    try {
        const res = await proxyFetch('https://e-pracownik.opi.org.pl:9901/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: creds.username, password: creds.password, provider: "ePracownik" })
        });
        return res.status === 200;
    } catch (e) {
        console.error("[DEBUG_LOG] API login failed.", e);
        return false;
    }
}
// =======================================================================


async function performUILogin() {
    console.log("[DEBUG_LOG] Attempting UI-based login...");
    const creds = await chrome.storage.local.get(["username", "password"]);
    if (!creds.username || !creds.password) {
        console.error("[DEBUG_LOG] Credentials not found in storage. Halting.");
        return;
    }

    const usernameField = await waitForElement(selectors.login.username);
    const passwordField = await waitForElement(selectors.login.password);
    const submitButton = await waitForElement(selectors.login.submit);

    if (!usernameField || !passwordField || !submitButton) {
        console.error("[DEBUG_LOG] Login form fields not found. Halting.");
        return;
    }

    console.log("[DEBUG_LOG] Filling login form...");
    fillInput(usernameField, creds.username);
    fillInput(passwordField, creds.password);
    await sleep(500);

    console.log("[DEBUG_LOG] Clicking submit button.");
    submitButton.click();
}


async function clickButton() {
    console.log("[DEBUG_LOG] On home page. Waiting for dashboard content...");
    const dzisiajLabel = await findByText(document.body, 'span', textMatchers.dzisiajLabel);
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
        return { success: false, reason: "Button not found (Could not find entry button)." };
    }

    console.log("[DEBUG_LOG] Button found. Clicking.", btn);
    btn.click();
    await sleep(500);

    const menuPanel = document.querySelector(selectors.contextMenu);
    if (menuPanel) {
        console.log("[DEBUG_LOG] Menu detected. Clicking 'Obecność'.");
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

    let finalStatus = { success: false, reason: "An unknown error occurred." };

    if (isOnHomePage()) {
        const isLoggedIn = await checkSessionStatus();
        if (isLoggedIn) {
            finalStatus = await clickButton();
        } else {
            finalStatus = { success: false, reason: "Not logged in. Redirecting to login."};
            await sleep(1000);
            if(isOnHomePage()) {
                window.location.href = "https://e-pracownik.opi.org.pl/#/auth/login";
            }
        }
    } else if (isOnLoginPage()) {
        const loginSuccess = await performUILogin();
        // This script will halt and re-run on the next page.
        // No notification is sent from this branch.
        return;
    } else {
        await sleep(2000);
        if (isOnHomePage() || isOnLoginPage()) {
            main(); // Re-run the logic now that the URL is stable
        }
        return;
    }

    // After all actions are complete, check the 'notify' preference and send a message
    const { notify } = await chrome.storage.local.get("notify");
    if (notify) {
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
