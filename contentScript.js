/* JavaScript */
const TARGET_URL = "https://e-pracownik.opi.org.pl/#/home";

console.log(`[DEBUG_LOG] Content script loaded. URL: ${location.href}`);

const selectors = {
    login: {
        username: "input[name='loginInput']",
        password: "input[name='passwordInput']",
        submit: "button[type='submit']"
    },
    presenceStatus: ".rcp-time-tracking-card-status-label--present",
    // This is the direct selector for the button shown in your HTML
    presenceButton: "div.smart-button.smart-button-add"
};
const textMatchers = {
    // This is a reliable text fallback
    markPresence: /rozpocznij/i
};

function isOnLoginPage() {
    return location.href.includes("/auth/login");
}

function isOnHomePage() {
    return location.href.includes("/#/home");
}

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
    console.error(`[DEBUG_LOG] Element not found after ${timeout}ms: ${selector}`);
    return null;
}

function fillInput(element, value) {
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
}

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
    console.log("[DEBUG_LOG] On home page. Waiting for dashboard content to render...");
    // Wait for a known, stable element on the page before proceeding
    const dzisiajLabel = await findByText(document.body, 'span', /dzisiaj/i);
    if (!dzisiajLabel) {
        console.error("[DEBUG_LOG] FAILURE: The 'Dzisiaj' label was not found. Dashboard may not have loaded.");
        return;
    }

    console.log("[DEBUG_LOG] Dashboard content detected. Now looking for the button.");
    await sleep(1000); // Short extra wait

    if (document.querySelector(selectors.presenceStatus)) {
        console.log("[DEBUG_LOG] SUCCESS: Already present.");
        return;
    }

    // Use the direct selector and the text-based fallback
    let btn = document.querySelector(selectors.presenceButton) || findByText(document.body, 'div, span', textMatchers.markPresence);

    if (!btn) {
        console.error("[DEBUG_LOG] FAILURE: Presence button not found with any method.");
        return;
    }

    // Ensure we click the main container div
    if (!btn.classList.contains('smart-button')) {
        btn = btn.closest('.smart-button');
    }

    if (!btn) {
        console.error("[DEBUG_LOG] FAILURE: Could not find parent .smart-button container to click.");
        return;
    }

    console.log("[DEBUG_LOG] SUCCESS: Button found. Clicking now.", btn);
    btn.click();

    // After clicking, we might need to select from a dropdown if one appears
    await sleep(500); // Wait for menu to potentially appear
    const menuPanel = document.querySelector("div.mat-mdc-menu-panel");
    if(menuPanel) {
        console.log("[DEBUG_LOG] Menu panel detected. Looking for 'Obecność' menu item.");
        const menuItem = findByText(menuPanel, 'button.mat-mdc-menu-item', /obecność/i);
        if(menuItem) {
            console.log("[DEBUG_LOG] Clicking 'Obecność' from menu.");
            menuItem.click();
        }
    }

    await sleep(2000);

    if (document.querySelector(selectors.presenceStatus)) {
        console.log("[DEBUG_LOG] SUCCESS: Presence confirmed after click.");
    } else {
        console.error("[DEBUG_LOG] FAILURE: Clicked button, but presence not confirmed.");
    }
}

// Replace the main() function in contentScript.js with this one

async function main() {
    console.log(`[DEBUG_LOG] Main logic starting on: ${location.href}`);

    let resultMessage = "Process finished with no specific result.";
    let wasSuccessful = false;

    const isLoggedIn = await checkSessionStatus();

    if (isLoggedIn) {
        console.log("[DEBUG_LOG] Session is valid.");
        if (isOnHomePage()) {
            const result = await clickButton();
            resultMessage = result.reason;
            wasSuccessful = result.success;
        } else {
            console.log("[DEBUG_LOG] Logged in but not on home page. Navigating...");
            window.location.href = TARGET_URL;
            return; // Stop here, the script will run again on the new page
        }
    } else {
        console.log("[DEBUG_LOG] Session is invalid. Performing login.");
        const loginSuccess = await performLogin();
        if (loginSuccess) {
            console.log("[DEBUG_LOG] Login successful. Requesting background script to navigate...");
            chrome.runtime.sendMessage({ type: "LOGIN_SUCCESSFUL_PLEASE_NAVIGATE" });
            return; // Stop here, the script will run again on the new page
        } else {
            resultMessage = "Login failed. Halting.";
            wasSuccessful = false;
            console.error(resultMessage);
        }
    }

    // After all actions, check if we should send a notification
    const { notify } = await chrome.storage.local.get("notify");
    if (notify && wasSuccessful) {
        chrome.runtime.sendMessage({
            type: "SHOW_NOTIFICATION",
            payload: {
                title: "e-Pracownik",
                message: resultMessage
            }
        });
    }
}

main();
