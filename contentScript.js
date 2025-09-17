/* JavaScript */
const TARGET_URL = "https://e-pracownik.opi.org.pl/#/home";

console.log(`[DEBUG_LOG] Content script loaded. URL: ${location.href}`);

const selectors = {
    presenceStatus: ".rcp-time-tracking-card-status-label--present, [class*='-present']",
    presenceButton: ".smart-button.smart-button-add"
};
const textMatchers = {
    markPresence: /rozpocznij/i
};

function isOnTargetPage() {
    return location.href.includes("/#/home");
}

async function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

function findByText(root, selector, regex) {
    for (const el of root.querySelectorAll(selector)) {
        if (regex.test(el.innerText || el.textContent)) return el;
    }
    return null;
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

async function clickButton() {
    console.log("[DEBUG_LOG] Now on home page. Waiting for widgets to render...");
    await sleep(4000);

    if (document.querySelector(selectors.presenceStatus)) {
        console.log("[DEBUG_LOG] SUCCESS: Already present.");
        return;
    }

    let btn = document.querySelector(selectors.presenceButton) || findByText(document.body, 'button, div', textMatchers.markPresence);
    if (!btn) {
        console.error("[DEBUG_LOG] FAILURE: Button not found. Capturing final HTML.");
        await capturePageContent();
        return;
    }

    console.log("[DEBUG_LOG] Button found. Clicking.");
    btn.click();
    await sleep(2000);

    if (document.querySelector(selectors.presenceStatus)) {
        console.log("[DEBUG_LOG] SUCCESS: Presence confirmed after click.");
    } else {
        console.error("[DEBUG_LOG] FAILURE: Clicked, but presence not confirmed. Capturing final HTML.");
        await capturePageContent();
    }
}

async function capturePageContent() {
    console.log("============== CAPTURED PAGE HTML CONTENT START ==============");
    console.log(document.documentElement.outerHTML);
    console.log("=============== CAPTURED PAGE HTML CONTENT END ===============");
}

async function main() {
    console.log(`[DEBUG_LOG] Main logic starting on: ${location.href}`);
    const isLoggedIn = await checkSessionStatus();

    if (isLoggedIn) {
        console.log("[DEBUG_LOG] Session is valid.");
        if (isOnTargetPage()) {
            await clickButton();
        } else {
            console.log("[DEBUG_LOG] Logged in but not on home page. Navigating...");
            window.location.href = TARGET_URL;
        }
    } else {
        console.log("[DEBUG_LOG] Session is invalid. Performing login.");
        const loginSuccess = await performLogin();
        if (loginSuccess) {
            // =================== THE ONLY CHANGE IS HERE ===================
            console.log("[DEBUG_LOG] Login successful. Waiting a moment before reloading...");
            // This brief pause is critical. It gives the browser time to save the cookie.
            await sleep(500);
            location.reload();
            // =============================================================
        } else {
            console.error("[DEBUG_LOG] Login failed. Halting.");
        }
    }
}

// This wrapper ensures the script runs only once the page is fully loaded
window.addEventListener('load', main);
