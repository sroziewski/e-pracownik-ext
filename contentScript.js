/* JavaScript */
const TARGET_URL = "https://e-pracownik.opi.org.pl/#/home";

const selectors = {
    presenceStatus: ".rcp-time-tracking-card-status-label--present",
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
            if (chrome.runtime.lastError || !response || !response.ok) {
                reject(new Error(response?.error || chrome.runtime.lastError?.message || "Proxy fetch failed"));
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
        console.error("[DEBUG_LOG] Session check failed.", e);
        return false;
    }
}

async function performLogin() {
    console.log("[DEBUG_LOG] Attempting API login...");
    const creds = await chrome.storage.local.get(["username", "password"]);
    if (!creds.username) return false;
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
    console.log("[DEBUG_LOG] On home page. Waiting for widgets...");
    await sleep(4000);

    if (document.querySelector(selectors.presenceStatus)) {
        console.log("[DEBUG_LOG] SUCCESS: Already present.");
        return;
    }

    let btn = document.querySelector(selectors.presenceButton) || findByText(document.body, 'button, div', textMatchers.markPresence);
    if (!btn) {
        console.error("[DEBUG_LOG] FAILURE: Button not found.");
        return;
    }

    console.log("[DEBUG_LOG] Button found. Clicking.");
    btn.click();
    await sleep(2000);

    if (document.querySelector(selectors.presenceStatus)) {
        console.log("[DEBUG_LOG] SUCCESS: Presence confirmed.");
    } else {
        console.error("[DEBUG_LOG] FAILURE: Clicked, but presence not confirmed.");
    }
}

async function main() {
    console.log(`[DEBUG_LOG] Main logic starting on: ${location.href}`);
    const isLoggedIn = await checkSessionStatus();

    if (isLoggedIn) {
        if (isOnTargetPage()) {
            await clickButton();
        } else {
            window.location.href = TARGET_URL;
        }
    } else {
        const loginSuccess = await performLogin();
        if (loginSuccess) {
            location.reload();
        } else {
            console.error("[DEBUG_LOG] Login failed. Halting.");
        }
    }
}

main();
