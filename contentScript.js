/* JavaScript */
const TARGET_URL = "https://e-pracownik.opi.org.pl/#/home";

console.log(`[DEBUG_LOG] Content script loaded. URL: ${location.href}`);

// =================== UPDATED SELECTORS FOR THE PRESENCE BUTTON ===================
const selectors = {
    login: {
        username: "input[name='loginInput']",
        password: "input[name='passwordInput']",
        submit: "button[type='submit']"
    },
    // This selector now specifically targets the purple "RCP" card that contains the button.
    rcpCard: "app-rcp-card",
    presenceStatus: ".rcp-time-tracking-card-status-label--present",
    // This is a very specific selector for the button based on your HTML.
    presenceButton: ".smart-button.smart-button-add.palette-Purple-300"
};
// ============================================================================

const textMatchers = {
    // This text is inside the button and is a great fallback.
    markPresence: /rozpocznij.*obecność/i
};

function isOnLoginPage() {
    return location.href.includes("/auth/login");
}

function isOnHomePage() {
    return location.href.includes("/#/home");
}

async function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

// Updated to be more flexible
function findByText(root, selector, regex) {
    for (const el of root.querySelectorAll(selector)) {
        if (regex.test(el.innerText || el.textContent)) return el;
    }
    return null;
}

async function waitForElement(selector, timeout = 7000) {
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
    console.log("[DEBUG_LOG] Now on home page. Waiting for RCP card to render...");
    // First, wait for the main "RCP" card to appear on the page.
    const rcpCard = await waitForElement(selectors.rcpCard);
    if (!rcpCard) {
        console.error("[DEBUG_LOG] FAILURE: The main RCP card was not found on the page.");
        await capturePageContent();
        return;
    }

    console.log("[DEBUG_LOG] RCP card found. Now checking status and looking for button inside it.");
    await sleep(1000); // Short extra wait for content inside the card

    if (rcpCard.querySelector(selectors.presenceStatus)) {
        console.log("[DEBUG_LOG] SUCCESS: Already present.");
        return;
    }

    // Look for the button using our specific and fallback methods, but only within the RCP card.
    let btn = rcpCard.querySelector(selectors.presenceButton) || findByText(rcpCard, 'div, span', textMatchers.markPresence);

    if (!btn) {
        console.error("[DEBUG_LOG] FAILURE: Presence button not found inside the RCP card. Capturing final HTML.");
        await capturePageContent();
        return;
    }

    // If we found the text, we need to click its parent container, the smart-button div
    if (!btn.classList.contains('smart-button')) {
        btn = btn.closest('.smart-button');
    }

    console.log("[DEBUG_LOG] Button found. Clicking.", btn);
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
        console.log("[DEBUG_LOG] Not on a recognized page yet, waiting for SPA redirect...");
        await sleep(2000);
        if (isOnLoginPage()) {
            await performUILogin();
        } else if(isOnHomePage()) {
            await clickButton();
        }
    }
}

main();
