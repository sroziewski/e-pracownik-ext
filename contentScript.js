/* JavaScript */
const TARGET_HOME_HASH = "#/home";

// Content script initialization logging
console.log(`[DEBUG_LOG] Content script loaded and initialized
URL: ${location.href}
Target Hash: ${TARGET_HOME_HASH}
User Agent: ${navigator.userAgent.split(' ').pop()}
Timestamp: ${new Date().toISOString()}
Process: Content script ready for CHECK_IN messages`);

/**
 * Configuration: Adjust these selectors to match the actual DOM.
 * Use your browser DevTools to inspect real elements and refine.
 */
const selectors = {
  // TODO: Update to the actual login form fields/selectors
  // Examples are placeholders
  login: {
    form: "form.ng-star-inserted, form[novalidate]",
    username: "input[name='loginInput'], input#mat-input-4, .mat-mdc-input-element[placeholder*='użytkownika']",
    password: "input[name='passwordInput'], input#mat-input-5, .mat-mdc-input-element[type='password']",
    submit: "button[type='submit'], button.mat-mdc-raised-button, button.mat-primary"
  },

  // Presence status element: something that indicates “already present”
  // TODO: Update to a definitive selector if possible
  presenceStatus: "[data-test='today-present'], .today-present, .presence-status",

  // Presence button to click to mark today as present
  // Prefer a direct, explicit button if available. Otherwise we’ll fall back to the Angular Material menu trigger.
  presenceButton: "button[data-test='presence-button'], button.mark-presence, .actions button"
};

// Fallback text checks for Polish UI (heuristic)
const textMatchers = {
  alreadyPresent: /obecny|obecność.*(dzisiaj|dziś)|zarejestrowano|jestes obecny/i,
  markPresence: /obecny|obecność|rozpocznij|start|odbicie|wejście|wejscie|rozpoczęcie/i,
  loginButton: /zaloguj|zarejestruj|sign in|log in/i
};

function isOnTargetPage() {
  return location.href.startsWith("https://e-pracownik.opi.org.pl/") && location.hash.startsWith(TARGET_HOME_HASH);
}

function visible(el) {
  if (!el) return false;
  const s = window.getComputedStyle(el);
  return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
}

function findByText(root, selector, regex) {
  const candidates = root.querySelectorAll(selector);
  for (const c of candidates) {
    const txt = (c.innerText || c.textContent || "").trim();
    if (txt && regex.test(txt) && visible(c)) return c;
  }
  return null;
}

async function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// Try to locate the Angular Material dropdown trigger with arrow_drop_down icon
function findArrowMenuTrigger() {
  const triggers = document.querySelectorAll("button.mat-mdc-menu-trigger, button[mat-icon-button].mat-mdc-menu-trigger");
  for (const btn of triggers) {
    if (!visible(btn)) continue;
    const icon = btn.querySelector("mat-icon, .mat-icon");
    const iconText = (icon?.innerText || icon?.textContent || "").trim();
    if (iconText === "arrow_drop_down") {
      return btn;
    }
  }
  return null;
}

// Find a menu item from the currently open Angular Material menu by text
function findMatMenuItemByText(regex) {
  // Angular Material v15+: .mat-mdc-menu-panel and .mat-mdc-menu-item
  // Older versions: .mat-menu-panel and .mat-menu-item
  const panels = document.querySelectorAll(".mat-mdc-menu-panel, .mat-menu-panel");
  for (const panel of panels) {
    if (!visible(panel)) continue;
    const items = panel.querySelectorAll(".mat-mdc-menu-item, .mat-menu-item, button, a");
    for (const it of items) {
      const t = (it.innerText || it.textContent || "").trim();
      if (t && regex.test(t) && visible(it)) {
        return it;
      }
    }
  }
  return null;
}

async function checkSessionStatus() {
  // Check if we have an active session by making a test API call
  try {
    console.log("[DEBUG_LOG] Checking session status via API test call...");
    
    const response = await fetch("https://e-pracownik.opi.org.pl:9901/api/calendar/configuration/schedule/default", {
      method: "GET",
      headers: {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9,pl;q=0.8,ru;q=0.7,it;q=0.6"
      },
      credentials: "include"
    });
    
    console.log(`[DEBUG_LOG] Session validation API response:
URL: /api/calendar/configuration/schedule/default
Status: ${response.status}
Status Text: ${response.statusText}
Headers: ${JSON.stringify([...response.headers.entries()])}
Timestamp: ${new Date().toISOString()}`);
    
    // Only treat authentication errors as invalid sessions
    if (response.status === 401 || response.status === 403 || response.statusText === "NO_ACTIVE_SESSION") {
      console.log(`[DEBUG_LOG] Session expired or invalid - authentication error detected
Status: ${response.status}
Action: Will perform re-authentication
Reason: Authentication failure indicates invalid SESSION_TOKEN`);
      return false;
    }
    
    // Server errors (5xx) don't indicate invalid sessions - the SESSION_TOKEN is still good
    if (response.status >= 500 && response.status < 600) {
      console.log(`[DEBUG_LOG] Server error detected but session appears valid
Status: ${response.status} (Server Error)
Action: Will skip re-authentication  
Reason: 5xx errors indicate server issues, not authentication problems
Session Status: VALID - SESSION_TOKEN should still work`);
      return true; // Session is valid, server is just having issues
    }
    
    // Success or other client errors (4xx that aren't auth-related)
    const isValid = response.ok;
    console.log(`[DEBUG_LOG] Session validation completed
Status: ${response.status}
Session Valid: ${isValid}
Action: ${isValid ? 'Skip re-authentication' : 'Investigate further'}
Timestamp: ${new Date().toISOString()}`);
    
    return isValid;
  } catch (error) {
    console.log(`[DEBUG_LOG] Session check network error - assuming invalid session
Error: ${error.message}
Action: Will perform re-authentication as fallback
Timestamp: ${new Date().toISOString()}`);
    return false;
  }
}

async function performDirectAPILogin(username, password) {
  // Direct API login call to /api/auth/login
  try {
    console.log("[DEBUG_LOG] Performing direct API login");
    
    const response = await fetch("https://e-pracownik.opi.org.pl:9901/api/auth/login", {
      method: "POST",
      headers: {
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "Accept-Language": "en-US,en;q=0.9,pl;q=0.8,ru;q=0.7,it;q=0.6",
        "Origin": "https://e-pracownik.opi.org.pl",
        "Referer": "https://e-pracownik.opi.org.pl/"
      },
      body: JSON.stringify({
        username: username,
        password: password,
        provider: "ePracownik"
      }),
      credentials: "include"
    });
    
    const data = await response.json();
    
    if (response.ok && data.userName) {
      console.log(`[DEBUG_LOG] API login successful for user: ${data.userName}`);
      
      // Verify SESSION_TOKEN cookie using chrome.cookies API (Set-Cookie headers are not accessible via JavaScript)
      try {
        // Check both the main domain and the API port domain for the cookie
        const cookieUrls = [
          "https://e-pracownik.opi.org.pl",
          "https://e-pracownik.opi.org.pl:9901"
        ];
        
        let sessionTokenFound = false;
        let sessionTokenValue = null;
        
        for (const url of cookieUrls) {
          try {
            const cookie = await chrome.cookies.get({
              url: url,
              name: "SESSION_TOKEN"
            });
            
            if (cookie && cookie.value) {
              sessionTokenFound = true;
              sessionTokenValue = cookie.value;
              
              console.log(`[DEBUG_LOG] LOGIN SUCCESS - SESSION_TOKEN COOKIE VERIFIED:
Cookie Name: SESSION_TOKEN
Cookie Value: ${sessionTokenValue}
Cookie Domain: ${cookie.domain}
Cookie Path: ${cookie.path}
Cookie Secure: ${cookie.secure}
Cookie HttpOnly: ${cookie.httpOnly}
Cookie SameSite: ${cookie.sameSite}
Cookie Source: Browser Cookie Store (chrome.cookies.get)
User: ${data.userName}
Timestamp: ${new Date().toISOString()}
Status: Cookie successfully stored and accessible via extension API`);
              
              // Send cookie value to background script for correlation logging
              chrome.runtime.sendMessage({
                type: "LOGIN_SUCCESS_COOKIE",
                cookieName: "SESSION_TOKEN",
                cookieValue: sessionTokenValue,
                userName: data.userName,
                timestamp: new Date().toISOString(),
                cookieDomain: cookie.domain,
                verificationMethod: "chrome.cookies.get"
              }).catch(error => {
                console.log(`[DEBUG_LOG] Failed to send LOGIN_SUCCESS_COOKIE message to background: ${error.message}`);
              });
              
              break; // Found cookie, no need to check other URLs
            }
          } catch (cookieError) {
            console.log(`[DEBUG_LOG] Cookie check failed for ${url}:`, cookieError);
          }
        }
        
        if (!sessionTokenFound) {
          console.log(`[DEBUG_LOG] LOGIN SUCCESS - SESSION_TOKEN COOKIE NOT FOUND:
Cookie Name: SESSION_TOKEN
Cookie Status: NOT_FOUND_IN_BROWSER_STORE
User: ${data.userName}
Verification Method: chrome.cookies.get
Checked URLs: ${cookieUrls.join(', ')}
Timestamp: ${new Date().toISOString()}
Note: Cookie may be cross-site blocked or have domain/path restrictions`);
        }
        
      } catch (error) {
        console.log(`[DEBUG_LOG] Cookie verification error:`, error);
      }
      
      // Test follow-up authenticated API call to verify cookie functionality
      try {
        console.log(`[DEBUG_LOG] Testing authenticated API call to verify cookie functionality...`);
        
        const testResponse = await fetch("https://e-pracownik.opi.org.pl:9901/api/calendar/configuration/schedule/default", {
          method: "GET",
          headers: {
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9,pl;q=0.8,ru;q=0.7,it;q=0.6"
          },
          credentials: "include" // This should send the SESSION_TOKEN cookie
        });
        
        console.log(`[DEBUG_LOG] FOLLOW-UP AUTHENTICATED API CALL RESULT:
API Endpoint: /api/calendar/configuration/schedule/default
HTTP Status: ${testResponse.status}
Status Text: ${testResponse.statusText}
Cookie Authentication: ${testResponse.ok ? 'SUCCESS - Cookie working properly' : 'FAILED - Cookie may not be sent or invalid'}
User: ${data.userName}
Timestamp: ${new Date().toISOString()}
Note: This confirms whether SESSION_TOKEN cookie is actually being sent in requests`);
        
        if (testResponse.ok) {
          console.log(`[DEBUG_LOG] ✅ SESSION_TOKEN COOKIE FUNCTIONAL VERIFICATION PASSED
The cookie is not only stored but also being sent correctly in authenticated requests.`);
        } else {
          console.log(`[DEBUG_LOG] ⚠️  SESSION_TOKEN COOKIE FUNCTIONALITY ISSUE DETECTED
Status: ${testResponse.status} - Cookie may be blocked by SameSite, domain restrictions, or session expired.`);
        }
        
      } catch (authTestError) {
        console.log(`[DEBUG_LOG] Follow-up authentication test failed:`, authTestError);
      }
      
      // SESSION_TOKEN cookie should be automatically set by the browser
      return true;
    } else {
      console.log(`[DEBUG_LOG] API login failed:`, data);
      return false;
    }
  } catch (error) {
    console.log("[DEBUG_LOG] API login error:", error);
    return false;
  }
}

// Track recent authentication attempts to prevent duplicates
let lastAuthenticationAttempt = null;
let authenticationInProgress = false;
const AUTHENTICATION_COOLDOWN = 29 * 24 * 60 * 60 * 1000; // 29 days - matches SESSION_TOKEN 30-day validity with 1-day safety buffer

async function isRecentAuthenticationValid() {
  if (!lastAuthenticationAttempt) return false;
  
  const timeSinceLastAuth = Date.now() - lastAuthenticationAttempt;
  if (timeSinceLastAuth > AUTHENTICATION_COOLDOWN) {
    console.log(`[DEBUG_LOG] Authentication cooldown expired (${timeSinceLastAuth}ms > ${AUTHENTICATION_COOLDOWN}ms)`);
    return false;
  }
  
  // Check if we still have a valid session from recent authentication
  try {
    const cookie = await chrome.cookies.get({
      url: "https://e-pracownik.opi.org.pl",
      name: "SESSION_TOKEN"
    });
    
    if (cookie && cookie.value) {
      console.log(`[DEBUG_LOG] Recent authentication still valid - SESSION_TOKEN exists
Recent Auth Time: ${new Date(lastAuthenticationAttempt).toISOString()}
Time Since Auth: ${timeSinceLastAuth}ms
Cookie Value: ${cookie.value.substring(0, 50)}...
Action: Skipping redundant authentication`);
      return true;
    }
  } catch (error) {
    console.log(`[DEBUG_LOG] Cookie check failed during recent auth validation:`, error);
  }
  
  return false;
}

async function tryLoginIfNeeded() {
  // Query global authentication state from background script
  try {
    const { isAuthenticated, timestamp, timeSinceLastAuth, cooldownActive } = await chrome.runtime.sendMessage({ type: "AUTH_STATE_QUERY" });
    
    if (isAuthenticated && cooldownActive) {
      console.log(`[DEBUG_LOG] Skipping login – recently authenticated via global state
Recent Auth Time: ${new Date(timestamp).toISOString()}
Time Since Auth: ${timeSinceLastAuth}ms
Cooldown Active: ${cooldownActive}
Action: Using existing SESSION_TOKEN from global authentication state`);
      return true;
    }
    
    if (cooldownActive) {
      console.log(`[DEBUG_LOG] Authentication cooldown active but session may be invalid
Recent Auth Time: ${new Date(timestamp).toISOString()}
Time Since Auth: ${timeSinceLastAuth}ms
Action: Will check session status before proceeding`);
    }
  } catch (error) {
    console.log(`[DEBUG_LOG] Failed to query global authentication state: ${error.message}`);
  }
  
  // Prevent concurrent authentication attempts using module-level flag as fallback
  if (authenticationInProgress) {
    console.log("[DEBUG_LOG] Authentication already in progress, skipping duplicate attempt");
    return false;
  }
  
  // First check if we have an active session
  const hasValidSession = await checkSessionStatus();
  if (hasValidSession && isOnTargetPage()) {
    console.log("[DEBUG_LOG] Valid session detected, no login needed");
    return true;
  }

  // Set authentication in progress flag
  authenticationInProgress = true;
  console.log(`[DEBUG_LOG] Starting authentication process
Authentication State: IN_PROGRESS
Timestamp: ${new Date().toISOString()}
Previous Auth: ${lastAuthenticationAttempt ? new Date(lastAuthenticationAttempt).toISOString() : 'NONE'}`);

  try {
    // If no valid session, get credentials
    const creds = await chrome.storage.local.get(["username", "password"]);
    const { username, password } = creds || {};

    if (!username || !password) {
      console.warn("[e-Pracownik] Missing credentials in extension options.");
      return false;
    }

    // Try direct API login first
    const apiLoginSuccess = await performDirectAPILogin(username, password);
    if (apiLoginSuccess) {
      // Record successful authentication timestamp
      lastAuthenticationAttempt = Date.now();
      console.log(`[DEBUG_LOG] Authentication completed successfully
Authentication State: SUCCESS
Timestamp: ${new Date().toISOString()}
Next Auth Allowed After: ${new Date(lastAuthenticationAttempt + AUTHENTICATION_COOLDOWN).toISOString()}`);
      
      // Navigate to home page after successful API login
      if (!isOnTargetPage()) {
        window.location.href = "https://e-pracownik.opi.org.pl/#/home";
        await sleep(2000); // Wait for navigation
      }
      return true;
    }
  } finally {
    // Always clear the in-progress flag
    authenticationInProgress = false;
    console.log(`[DEBUG_LOG] Authentication process completed
Authentication State: FINISHED
Timestamp: ${new Date().toISOString()}`);
  }

  // Fallback to form-based login if on login page
  if (location.href.includes("#/auth/login") || location.href.includes("/login")) {
    const loginForm = document.querySelector(selectors.login.form);
    const usernameEl = document.querySelector(selectors.login.username);
    const passwordEl = document.querySelector(selectors.login.password);

    if (loginForm || usernameEl || passwordEl) {
      console.log("[DEBUG_LOG] Filling login form as fallback");
      
      // Fill form fields
      if (usernameEl) {
        usernameEl.value = username;
        usernameEl.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (passwordEl) {
        passwordEl.value = password;
        passwordEl.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Click submit
      let submitBtn = document.querySelector(selectors.login.submit) || findByText(document, "button, input[type='submit']", textMatchers.loginButton);
      if (submitBtn) {
        submitBtn.click();
      } else if (loginForm) {
        loginForm.submit?.();
      }

      // Wait for navigation/render
      for (let i = 0; i < 30; i++) {
        await sleep(500);
        if (isOnTargetPage() && !document.querySelector(selectors.login.form)) {
          return true;
        }
      }
      return isOnTargetPage();
    }
  }

  // If not on login page, navigate there
  if (!location.href.includes("#/auth/login")) {
    console.log("[DEBUG_LOG] Navigating to login page");
    window.location.href = "https://e-pracownik.opi.org.pl/#/auth/login";
    await sleep(3000); // Wait for navigation
    
    // Try form login after navigation
    return tryLoginIfNeeded();
  }

  return false;
}

function alreadyPresent() {
  // 1) Dedicated status element
  const status = document.querySelector(selectors.presenceStatus);
  if (status) {
    const txt = (status.innerText || status.textContent || "").trim();
    if (textMatchers.alreadyPresent.test(txt)) return true;
    // If status element exists and has semantic "true" attributes, add checks here if known.
  }

  // 2) Look for badges/labels that obviously indicate presence
  const possible = Array.from(document.querySelectorAll("[class*='status'], [class*='present'], [data-test*='present']"));
  for (const el of possible) {
    const txt = (el.innerText || el.textContent || "").trim();
    if (textMatchers.alreadyPresent.test(txt)) return true;
  }

  return false;
}

async function clickPresenceButtonIfNeeded() {
  if (alreadyPresent()) {
    return { changed: false, reason: "Already present" };
  }

  // Find a likely direct presence button first
  let btn =
    document.querySelector(selectors.presenceButton) ||
    findByText(document, "button, a, .btn, .mat-button, .mat-raised-button", textMatchers.markPresence);

  // If not found, fall back to the Angular Material dropdown trigger
  if (!btn) {
    btn = findArrowMenuTrigger();
  }

  if (!btn) {
    return { changed: false, reason: "Presence button or menu trigger not found. Adjust selectors." };
  }

  btn.click();

  // If we clicked a menu trigger, choose the appropriate menu item
  // Wait shortly for the menu panel to appear, then click the item that matches presence
  for (let i = 0; i < 10; i++) {
    await sleep(200);
    const menuItem = findMatMenuItemByText(textMatchers.markPresence);
    if (menuItem) {
      menuItem.click();
      break;
    }
  }

  // Wait for confirmation UI/state change
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    if (alreadyPresent()) {
      return { changed: true, reason: "Presence set" };
    }
  }
  return { changed: false, reason: "Clicked but status did not confirm. UI may differ." };
}

async function ensurePresence() {
  try {
    const loggedIn = await tryLoginIfNeeded();
    if (!loggedIn) {
      return { ok: false, message: "Login failed or credentials missing." };
    }

    // Sometimes the SPA needs a moment to load dashboard widgets
    for (let i = 0; i < 10; i++) {
      await sleep(500);
      if (document.body) break;
    }

    const result = await clickPresenceButtonIfNeeded();
    return {
      ok: true,
      message: result.changed ? "Marked present for today." : `No change: ${result.reason}`
    };
  } catch (e) {
    console.error("[e-Pracownik] ensurePresence error", e);
    return { ok: false, message: e?.message || "Unknown error" };
  }
}

// Listen for background/popup messages to trigger
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "CHECK_IN") {
    console.log(`[DEBUG_LOG] Content script received CHECK_IN message
Script URL: ${location.href}
Tab ID: Content script context
Message Type: ${msg.type}
Process: Starting ensurePresence() function
Timestamp: ${new Date().toISOString()}`);
    
    ensurePresence().then((res) => {
      console.log(`[DEBUG_LOG] ensurePresence() completed
Result Status: ${res.ok ? 'SUCCESS' : 'FAILED'}
Message: ${res.message}
Process: Presence check workflow finished
Timestamp: ${new Date().toISOString()}`);
      
      // Send completion message to background script for tab cleanup
      chrome.runtime.sendMessage({
        type: "PRESENCE_CHECK_COMPLETE",
        success: res.ok,
        tabId: msg.tabId,
        clickSessionId: msg.clickSessionId,
        processId: msg.processId
      }).then(() => {
        console.log(`[DEBUG_LOG] PRESENCE_CHECK_COMPLETE message sent to background
Success: ${res.ok}
Tab ID: ${msg.tabId || "UNKNOWN"}
Click Session ID: ${msg.clickSessionId || "UNKNOWN"}
Process ID: ${msg.processId || "UNKNOWN"}
Action: ${res.ok ? "Tab cleanup requested" : "Tab kept for debugging"}
Timestamp: ${new Date().toISOString()}`);
      }).catch(error => {
        console.log(`[DEBUG_LOG] Failed to send PRESENCE_CHECK_COMPLETE message: ${error.message}`);
      });
      
      // Optional: show system notification
      chrome.storage.local.get(["notify"]).then(({ notify }) => {
        if (notify) {
          chrome.runtime.sendMessage({
            type: "SHOW_NOTIFICATION",
            payload: {
              title: "e-Pracownik",
              message: res.message
            }
          }).catch(error => {
            console.log(`[DEBUG_LOG] Failed to send SHOW_NOTIFICATION message to background: ${error.message}`);
          });
        }
      });
      sendResponse(res);
    });
    return true; // async response
  }
});

// Background may request notifications
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "SHOW_NOTIFICATION") {
    const { title, message } = msg.payload || {};
    if (title && message && chrome?.notifications) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon128.png",
        title,
        message
      });
    }
  }
});
