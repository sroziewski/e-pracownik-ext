/* JavaScript */
const TARGET_URL = "https://e-pracownik.opi.org.pl/#/home";

console.log(`[DEBUG_LOG] Content script loaded. URL: ${location.href}`);

// =================== CORRECTED SELECTORS BASED ON YOUR HTML ===================
const selectors = {
    login: {
        username: "input[name='loginInput']", // Using the correct 'name' attribute
        password: "input[name='passwordInput']", // Using the correct 'name' attribute
        submit: "button[type='submit']"
    },
    presenceStatus: ".rcp-time-tracking-card-status-label--present",
    presenceButton: ".smart-button.smart-button-add"
};
// ============================================================================

const textMatchers = {
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

// A helper function to robustly wait for an element to appear in the DOM
async function waitForElement(selector, timeout = 5000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
        const element = document.querySelector(selector);
        if (element) return element;
        await sleep(200);
    }
    return null; // Return null if the element is not found within the timeout
}


// Function to fill an input field and trigger Angular's change detection
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

    // Use the robust waitForElement function to find the form fields
    const usernameField = await waitForElement(selectors.login.username);
    const passwordField = await waitForElement(selectors.login.password);
    const submitButton = await waitForElement(selectors.login.submit);

    if (!usernameField || !passwordField || !submitButton) {
        console.error("[DEBUG_LOG] Login form fields not found even after waiting. Halting. Please check selectors.");
        return;
    }

    console.log("[DEBUG_LOG] Login form fields found. Filling form...");
    fillInput(usernameField, creds.username);
    fillInput(passwordField, creds.password);

    await sleep(500);

    console.log("[DEBUG_LOG] Clicking submit button.");
    submitButton.click();
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
    await sleep(1000);

    if (isOnHomePage()) {
        console.log("[DEBUG_LOG] Detected we are on the home page.");
        await clickButton();
    } else if (isOnLoginPage()) {
        console.log("[DEBUG_LOG] Detected we are on the login page.");
        await performUILogin();
    } else {
        // This case handles when the script loads before the SPA redirects to /#/auth/login
        console.log("[DEBUG_LOG] Not on a recognized page yet, waiting for SPA redirect...");
        await sleep(2000); // Wait for the redirect
        if (isOnLoginPage()) {
            console.log("[DEBUG_LOG] Redirect to login page detected.");
            await performUILogin();
        } else if(isOnHomePage()) {
            console.log("[DEBUG_LOG] Redirect to home page detected (already logged in).");
            await clickButton();
        }
    }
}

// Start the process directly.
main();
