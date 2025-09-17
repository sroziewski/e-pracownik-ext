/* JavaScript */
// Announce that the content script is loaded and ready
chrome.runtime.sendMessage({ type: "CONTENT_SCRIPT_READY" });

const TARGET_HOME_HASH = "#/home";
const TARGET_URL = "https://e-pracownik.opi.org.pl/#/home";

let currentSession = {};

console.log(`[DEBUG_LOG] Content script loaded. URL: ${location.href}`);

const selectors = {
    login: {
        username: "input[name='loginInput']",
        password: "input[name='passwordInput']",
        submit: "button[type='submit']"
    },
    presenceStatus: ".rcp-time-tracking-card-status-label--present, [class*='-present']",
    presenceButton: ".smart-button.smart-button-add" // Primary, specific selector
};

// =================== FIX STARTS HERE ===================
// Added a text matcher as a reliable fallback
const textMatchers = {
    markPresence: /rozpocznij/i
};
// =================== FIX ENDS HERE ===================


function isOnTargetPage() {
    return location.href.startsWith(TARGET_URL);
}

async function sleep(ms) {
    return new Promise(res => setTimeout(res, ms));
}

function findByText(root, selector, regex) {
    const candidates = root.querySelectorAll(selector);
    for (const c of candidates) {
        const txt = (c.innerText || c.textContent || "").trim();
        if (txt && regex.test(txt)) return c;
    }
    return null;
}

async function checkSessionStatus() {
    console.log("[DEBUG_LOG] Checking session status via API test call...");
    try {
        const proxyResponse = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                type: 'PROXY_FETCH',
                payload: { url: 'https://e-pracownik.opi.org.pl:9901/api/calendar/configuration/schedule/default' }
            }, response => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else if (response) {
                    resolve(response.response);
                } else {
                    reject(new Error('No response from background script.'));
                }
            });
        });

        if ([401, 403, 500].includes(proxyResponse.status)) {
            console.log(`[DEBUG_LOG] Session check indicates LOGGED OUT (status: ${proxyResponse.status})`);
            return false;
        }

        if (proxyResponse.status >= 200 && proxyResponse.status < 300) {
            console.log(`[DEBUG_LOG] Session check indicates LOGGED IN (status: ${proxyResponse.status})`);
            return true;
        }

        console.log(`[DEBUG_LOG] Session check returned unexpected status ${proxyResponse.status}. Assuming logged out.`);
        return false;

    } catch (error) {
        console.log(`[DEBUG_LOG] Session check network error. Assuming logged out. Error: ${error.message}`);
        return false;
    }
}

async function performDirectAPILogin(username, password) {
    console.log("[DEBUG_LOG] Performing direct API login via background proxy");
    try {
        const loginResponse = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                type: 'PROXY_FETCH',
                payload: {
                    url: 'https://e-pracownik.opi.org.pl:9901/api/auth/login',
                    options: {
                        method: 'POST',
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ username, password, provider: "ePracownik" })
                    }
                }
            }, response => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else if (response) {
                    resolve(response.response);
                } else {
                    reject(new Error('No response from background for login.'));
                }
            });
        });

        return loginResponse.status === 200;
    } catch (error) {
        console.log(`[DEBUG_LOG] API login proxy error: ${error.message}`);
        return false;
    }
}

async function tryLoginIfNeeded() {
    const hasValidSession = await checkSessionStatus();

    if (hasValidSession) {
        if (!isOnTargetPage()) {
            console.log("[DEBUG_LOG] Logged in but on wrong page. Navigating to home...");
            window.location.href = TARGET_URL;
            await new Promise(() => {});
        }
        console.log("[DEBUG_LOG] Valid session detected. No login needed.");
        return true;
    }

    console.log("[DEBUG_LOG] No valid session. Attempting login.");
    const creds = await chrome.storage.local.get(["username", "password"]);
    if (!creds.username || !creds.password) {
        console.warn("[e-Pracownik] Credentials missing.");
        return false;
    }

    const apiLoginSuccess = await performDirectAPILogin(creds.username, creds.password);
    if (apiLoginSuccess) {
        console.log("[DEBUG_LOG] Login successful, requesting navigation to home page.");
        chrome.runtime.sendMessage({
            type: "LOGIN_SUCCESSFUL",
            clickSessionId: currentSession.clickSessionId
        });
        await new Promise(() => {});
    } else {
        console.log("[DEBUG_LOG] API login failed.");
    }
    return false;
}

async function clickPresenceButtonIfNeeded() {
    if (document.querySelector(selectors.presenceStatus)) {
        console.log("[DEBUG_LOG] Already marked as present.");
        return { changed: false, reason: "Already marked as present." };
    }

    // =================== FIX STARTS HERE ===================
    // Try the specific selector first, then fall back to the text search.
    let btn = document.querySelector(selectors.presenceButton) || findByText(document.body, 'button', textMatchers.markPresence);

    if (!btn) {
        console.log("[DEBUG_LOG] Presence button not found using selectors. The process will be marked as failed.");
        return { changed: false, reason: "Presence button not found." };
    }

    console.log("[DEBUG_LOG] Presence button found. Clicking it now.", btn);
    // =================== FIX ENDS HERE ===================

    btn.click();
    await sleep(1000);

    for (let i = 0; i < 20; i++) {
        if (document.querySelector(selectors.presenceStatus)) {
            console.log("[DEBUG_LOG] Presence confirmed after click.");
            return { changed: true, reason: "Presence successfully set." };
        }
        await sleep(500);
    }

    console.log("[DEBUG_LOG] Clicked button, but presence was not confirmed.");
    return { changed: false, reason: "Clicked but status did not confirm." };
}

async function ensurePresence() {
    try {
        const loggedIn = await tryLoginIfNeeded();
        if (!loggedIn) {
            return { ok: false, message: "Login failed or navigation issue." };
        }

        console.log("[DEBUG_LOG] Logged in and on home page. Proceeding to check presence.");
        await sleep(2500); // Increased wait for widgets to be safe

        await capturePageContent();

        const result = await clickPresenceButtonIfNeeded();

        // =================== FIX STARTS HERE ===================
        // Consider it a "success" if we are already present OR if we successfully clicked.
        const isSuccess = result.reason.includes("Already marked as present") || result.changed;
        return { ok: isSuccess, message: result.reason };
        // =================== FIX ENDS HERE ===================

    } catch (e) {
        console.error("[e-Pracownik] ensurePresence error", e);
        return { ok: false, message: e?.message || "Unknown error" };
    }
}

async function capturePageContent() {
    console.log("============== CAPTURED PAGE HTML CONTENT START ==============");
    console.log(document.documentElement.outerHTML);
    console.log("=============== CAPTURED PAGE HTML CONTENT END ===============");
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "CHECK_IN") {
        currentSession = {
            clickSessionId: msg.clickSessionId,
            processId: msg.processId,
            tabId: msg.tabId
        };

        console.log(`[DEBUG_LOG] Received CHECK_IN. Starting ensurePresence()`);

        ensurePresence().then(res => {
            console.log(`[DEBUG_LOG] ensurePresence() completed. Result: ${res.message}`);
            chrome.runtime.sendMessage({
                type: "PRESENCE_CHECK_COMPLETE",
                success: res.ok,
                ...currentSession
            });
        });
    }
});
