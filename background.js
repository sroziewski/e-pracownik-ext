/* JavaScript */
const TARGET_URL = "https://e-pracownik.opi.org.pl/#/home";
const ALARM_NAME = "autoCheckPresence";

// Generate unique session identifier for this service worker instance
const sessionId = `sw_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// Extension startup logging
console.log(`[DEBUG_LOG] e-Pracownik Extension Starting Up
Extension ID: ${chrome.runtime.id}
Extension Version: ${chrome.runtime.getManifest().version}
Platform: ${navigator.platform}
Timestamp: ${new Date().toISOString()}
Service Worker Session: ${sessionId}
Runtime Context: ${typeof importScripts !== 'undefined' ? 'Service Worker' : 'Unknown'}`);

// Store active click sessions to correlate with HTTP requests
let activeClickSessions = new Map();

async function openTargetAndRunCheck(clickSessionId = null) {
  const processId = `check_${Date.now()}`;
  
  console.log(`[DEBUG_LOG] Starting presence check process
Process ID: ${processId}
Click Session ID: ${clickSessionId || 'AUTO_SCHEDULED'}
Target URL: ${TARGET_URL}
Timestamp: ${new Date().toISOString()}`);

  // Store the session for HTTP request correlation
  if (clickSessionId) {
    activeClickSessions.set(clickSessionId, {
      processId: processId,
      startTime: new Date().toISOString(),
      status: 'PROCESSING'
    });
  }

  // OPTIMIZATION: Check for existing tabs first before creating new ones
  let tab;
  let tabCreated = false;
  let tabReused = false;

  try {
    // Find existing tab with the target URL
    const existingTabs = await chrome.tabs.query({
      url: "https://e-pracownik.opi.org.pl/*"
    });

    if (existingTabs.length > 0) {
      // Reuse the first existing tab
      tab = existingTabs[0];
      tabReused = true;
      
      // Update the tab URL and focus it
      await chrome.tabs.update(tab.id, { 
        url: TARGET_URL, 
        active: false // Keep it in background as before
      });
      
      console.log(`[DEBUG_LOG] REUSING EXISTING TAB for presence check
Tab ID: ${tab.id}
Tab URL: ${tab.url}
Process ID: ${processId}
Click Session ID: ${clickSessionId || 'AUTO_SCHEDULED'}
Tab Management: REUSED_EXISTING_TAB
Resource Usage: OPTIMIZED - No new tab created
Timestamp: ${new Date().toISOString()}`);
      
    } else {
      // Create new tab only if none exists
      tab = await new Promise((resolve) => {
        chrome.tabs.create({ url: TARGET_URL, active: false }, resolve);
      });
      tabCreated = true;
      
      console.log(`[DEBUG_LOG] CREATED NEW TAB for presence check
Tab ID: ${tab.id}
Tab URL: ${tab.url}
Process ID: ${processId}
Click Session ID: ${clickSessionId || 'AUTO_SCHEDULED'}
Tab Management: CREATED_NEW_TAB
Resource Usage: NEW_RESOURCE - No existing tab available
Timestamp: ${new Date().toISOString()}`);
    }

  } catch (error) {
    console.log(`[DEBUG_LOG] Tab management error, falling back to new tab creation: ${error.message}`);
    
    // Fallback: create new tab if query/update fails
    tab = await new Promise((resolve) => {
      chrome.tabs.create({ url: TARGET_URL, active: false }, resolve);
    });
    tabCreated = true;
  }

  const tabId = tab.id;

  // Store tab info in session for potential cleanup
  if (clickSessionId) {
    activeClickSessions.set(clickSessionId, {
      ...activeClickSessions.get(clickSessionId),
      tabId: tabId,
      tabCreated: tabCreated,
      tabReused: tabReused
    });
  }

  // The temporary onUpdated listener and setTimeout that were here have been removed.
  // A new global, persistent listener at the end of the file now handles this logic robustly.
}

chrome.runtime.onInstalled.addListener(() => {
  // Create a default daily alarm at 08:05 local time if user enables it in options later.
  // We won't schedule until the user enables it, but we keep handler ready.
});

// Store session state for authentication tracking
let authenticationState = {
  isAuthenticated: false,
  lastLoginAttempt: null,
  sessionToken: null
};

// HTTP Request Monitoring - Enhanced with authentication and session management
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.url.includes('e-pracownik.opi.org.pl')) {
      // Find associated click session for correlation
      let correlatedSession = null;
      for (const [sessionId, sessionData] of activeClickSessions.entries()) {
        if (sessionData.status === 'PROCESSING') {
          correlatedSession = { sessionId, ...sessionData };
          break;
        }
      }
      
      // Special handling for authentication endpoints
      if (details.url.includes('/api/auth/login')) {
        if (details.statusCode === 200) {
          authenticationState.isAuthenticated = true;
          authenticationState.lastLoginAttempt = new Date().toISOString();
          
          // Verify SESSION_TOKEN cookie using chrome.cookies API (async operation)
          // Set-Cookie headers are not reliably accessible via webRequest due to browser security
          setTimeout(async () => {
            try {
              // Check both the main domain and the API port domain for the cookie
              const cookieUrls = [
                "https://e-pracownik.opi.org.pl",
                "https://e-pracownik.opi.org.pl:9901"
              ];
              
              let sessionToken = 'NOT_FOUND';
              let cookieDetails = null;
              
              for (const url of cookieUrls) {
                try {
                  const cookie = await chrome.cookies.get({
                    url: url,
                    name: "SESSION_TOKEN"
                  });
                  
                  if (cookie && cookie.value) {
                    sessionToken = cookie.value;
                    cookieDetails = cookie;
                    // Store in authentication state
                    authenticationState.sessionToken = sessionToken;
                    break; // Found cookie, no need to check other URLs
                  }
                } catch (cookieError) {
                  console.log(`[DEBUG_LOG] Cookie check failed for ${url}:`, cookieError);
                }
              }
              
              console.log(`[DEBUG_LOG] AUTHENTICATION SUCCESS - LOGIN API (COOKIE VERIFIED)
URL: ${details.url}
Method: ${details.method}
Status Code: ${details.statusCode}
Authentication State: SUCCESS
SESSION_TOKEN: ${sessionToken}
Cookie Domain: ${cookieDetails?.domain || 'N/A'}
Cookie Verification: ${sessionToken !== 'NOT_FOUND' ? 'FOUND_VIA_CHROME_COOKIES' : 'NOT_FOUND_IN_BROWSER_STORE'}
Click Session ID: ${correlatedSession?.sessionId || 'NO_ACTIVE_SESSION'}
Timestamp: ${new Date().toISOString()}`);
              
            } catch (error) {
              console.log(`[DEBUG_LOG] AUTHENTICATION SUCCESS - LOGIN API (COOKIE CHECK ERROR)
URL: ${details.url}
Method: ${details.method}
Status Code: ${details.statusCode}
Authentication State: SUCCESS
SESSION_TOKEN: VERIFICATION_FAILED
Cookie Check Error: ${error.message}
Click Session ID: ${correlatedSession?.sessionId || 'NO_ACTIVE_SESSION'}
Timestamp: ${new Date().toISOString()}`);
            }
          }, 100); // Small delay to ensure cookie is stored
          
          // Immediate success log without cookie verification (async follows)
          console.log(`[DEBUG_LOG] AUTHENTICATION SUCCESS - LOGIN API
URL: ${details.url}
Method: ${details.method}
Status Code: ${details.statusCode}
Authentication State: SUCCESS
SESSION_TOKEN: VERIFYING_VIA_CHROME_COOKIES
Click Session ID: ${correlatedSession?.sessionId || 'NO_ACTIVE_SESSION'}
Timestamp: ${new Date().toISOString()}`);
        } else {
          authenticationState.isAuthenticated = false;
          console.log(`[DEBUG_LOG] AUTHENTICATION FAILED - LOGIN API
URL: ${details.url}
Method: ${details.method}
Status Code: ${details.statusCode}
Authentication State: FAILED
Click Session ID: ${correlatedSession?.sessionId || 'NO_ACTIVE_SESSION'}
Timestamp: ${new Date().toISOString()}`);
        }
      }
      
      // Handle session validation endpoints
      if (details.url.includes('/api/calendar/configuration') || details.url.includes('/api/')) {
        if (details.statusCode === 401) {
          authenticationState.isAuthenticated = false;
          console.log(`[DEBUG_LOG] SESSION EXPIRED - API CALL UNAUTHORIZED
URL: ${details.url}
Method: ${details.method}
Status Code: ${details.statusCode}
Authentication State: SESSION_EXPIRED
Click Session ID: ${correlatedSession?.sessionId || 'NO_ACTIVE_SESSION'}
Timestamp: ${new Date().toISOString()}`);
        }
      }
      
      console.log(`[DEBUG_LOG] HTTP REQUEST STATUS - ENHANCED MONITORING
URL: ${details.url}
Method: ${details.method}
Status Code: ${details.statusCode}
Click Session ID: ${correlatedSession?.sessionId || 'NO_ACTIVE_SESSION'}
Process ID: ${correlatedSession?.processId || 'UNKNOWN'}
Request Type: ${details.url.includes('/api/') ? 'API_CALL' : 'PAGE_LOAD'}
Authentication State: ${authenticationState.isAuthenticated ? 'AUTHENTICATED' : 'NOT_AUTHENTICATED'}
Endpoint Type: ${details.url.includes('/auth/') ? 'AUTH_ENDPOINT' : details.url.includes('/api/') ? 'API_ENDPOINT' : 'PAGE_REQUEST'}
Timestamp: ${new Date().toISOString()}
Button Click Status: ${correlatedSession ? 'CORRELATED' : 'STANDALONE'}`);
      
      // Update session status for significant API calls
      if (correlatedSession && details.url.includes('/api/')) {
        activeClickSessions.set(correlatedSession.sessionId, {
          ...correlatedSession,
          status: 'API_COMPLETED',
          lastApiStatus: details.statusCode,
          lastApiUrl: details.url,
          authenticationStatus: authenticationState.isAuthenticated
        });
      }
    }
  },
  {
    urls: ["https://e-pracownik.opi.org.pl/*"]
  },
  ["responseHeaders"]
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (details.url.includes('e-pracownik.opi.org.pl')) {
      // Find associated click session for correlation
      let correlatedSession = null;
      for (const [sessionId, sessionData] of activeClickSessions.entries()) {
        if (sessionData.status === 'PROCESSING') {
          correlatedSession = { sessionId, ...sessionData };
          break;
        }
      }
      
      console.log(`[DEBUG_LOG] HTTP REQUEST ERROR - BUTTON CLICK CORRELATION
URL: ${details.url}
Method: ${details.method}
Error: ${details.error}
Click Session ID: ${correlatedSession?.sessionId || 'NO_ACTIVE_SESSION'}
Process ID: ${correlatedSession?.processId || 'UNKNOWN'}
Timestamp: ${new Date().toISOString()}
Button Click Status: ${correlatedSession ? 'CORRELATED_ERROR' : 'STANDALONE_ERROR'}`);
      
      // Update session status for errors
      if (correlatedSession) {
        activeClickSessions.set(correlatedSession.sessionId, {
          ...correlatedSession,
          status: 'ERROR',
          error: details.error,
          errorUrl: details.url
        });
      }
    }
  },
  {
    urls: ["https://e-pracownik.opi.org.pl/*"]
  }
);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    openTargetAndRunCheck();
  }
});

// Messages from popup/options
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "RUN_CHECK_NOW") {
    const clickSessionId = msg.clickSessionId;
    console.log(`[DEBUG_LOG] RUN_CHECK_NOW message received in background
Click Session ID: ${clickSessionId}
Message Source: Popup button click
Timestamp: ${new Date().toISOString()}
Action: Initiating openTargetAndRunCheck with session tracking`);
    
    openTargetAndRunCheck(clickSessionId);
    sendResponse({ 
      ok: true, 
      clickSessionId: clickSessionId,
      status: 'INITIATED'
    });
  }
  
  // NEW: Handle navigation requests from content scripts
  if (msg?.type === "NAVIGATE_TAB") {
    if (_sender.tab && _sender.tab.id && msg.url) {
      console.log(`[DEBUG_LOG] Received NAVIGATE_TAB request for tab ${_sender.tab.id} to URL ${msg.url}`);
      chrome.tabs.update(_sender.tab.id, { url: msg.url });
      // No response needed, this is a fire-and-forget action.
    }
    return; // No async response.
  }
  
  if (msg?.type === "LOGIN_SUCCESS_COOKIE") {
    // Find associated click session for correlation
    let correlatedSession = null;
    for (const [sessionId, sessionData] of activeClickSessions.entries()) {
      if (sessionData.status === 'PROCESSING' || sessionData.status === 'API_COMPLETED') {
        correlatedSession = { sessionId, ...sessionData };
        break;
      }
    }
    
    console.log(`[DEBUG_LOG] BACKGROUND - LOGIN SUCCESS COOKIE RECEIVED (CHROME.COOKIES VERIFIED)
Cookie Name: ${msg.cookieName}
Cookie Value: ${msg.cookieValue}
User Name: ${msg.userName}
Cookie Domain: ${msg.cookieDomain || 'Unknown'}
Verification Method: ${msg.verificationMethod || 'chrome.cookies.get'}
Cookie Source: Content Script via chrome.cookies API
Click Session ID: ${correlatedSession?.sessionId || 'NO_ACTIVE_SESSION'}
Process ID: ${correlatedSession?.processId || 'UNKNOWN'}
Background Auth State: ${authenticationState.isAuthenticated ? 'AUTHENTICATED' : 'NOT_AUTHENTICATED'}
Correlation Status: ${correlatedSession ? 'CORRELATED_LOGIN' : 'STANDALONE_LOGIN'}
Content Script Timestamp: ${msg.timestamp}
Background Timestamp: ${new Date().toISOString()}
Cookie Status: SUCCESSFULLY_VERIFIED_AND_ACCESSIBLE`);
    
    // Store cookie value in authentication state for future reference
    authenticationState.sessionToken = msg.cookieValue;
    
    // Update session with cookie information including enhanced fields
    if (correlatedSession) {
      activeClickSessions.set(correlatedSession.sessionId, {
        ...correlatedSession,
        status: 'LOGIN_COMPLETED',
        cookieValue: msg.cookieValue,
        cookieDomain: msg.cookieDomain,
        verificationMethod: msg.verificationMethod,
        userName: msg.userName,
        loginTimestamp: msg.timestamp
      });
    }
    
    sendResponse({ ok: true, status: 'COOKIE_LOGGED' });
  }

  if (msg?.type === "AUTH_STATE_QUERY") {
    // Handle authentication state queries from content scripts
    const AUTHENTICATION_COOLDOWN = 29 * 24 * 60 * 60 * 1000; // 29 days - matches SESSION_TOKEN 30-day validity with 1-day safety buffer
    const now = Date.now();
    let isRecentlyAuthenticated = false;
    let timeSinceLastAuth = 0;
    
    if (authenticationState.lastLoginAttempt) {
      const lastAuthTime = new Date(authenticationState.lastLoginAttempt).getTime();
      timeSinceLastAuth = now - lastAuthTime;
      isRecentlyAuthenticated = timeSinceLastAuth < AUTHENTICATION_COOLDOWN;
    }
    
    console.log(`[DEBUG_LOG] AUTH_STATE_QUERY received from content script
Authentication State: ${authenticationState.isAuthenticated ? 'AUTHENTICATED' : 'NOT_AUTHENTICATED'}
Last Login Attempt: ${authenticationState.lastLoginAttempt || 'NEVER'}
Time Since Last Auth: ${timeSinceLastAuth}ms
Recently Authenticated: ${isRecentlyAuthenticated}
Cooldown Period: ${AUTHENTICATION_COOLDOWN}ms
Session Token Present: ${authenticationState.sessionToken ? 'YES' : 'NO'}
Timestamp: ${new Date().toISOString()}`);
    
    sendResponse({
      isAuthenticated: authenticationState.isAuthenticated && isRecentlyAuthenticated,
      timestamp: authenticationState.lastLoginAttempt ? new Date(authenticationState.lastLoginAttempt).getTime() : 0,
      timeSinceLastAuth: timeSinceLastAuth,
      cooldownActive: isRecentlyAuthenticated,
      sessionToken: authenticationState.sessionToken
    });
  }

  // NEW: Handle presence check completion and tab cleanup
  if (msg?.type === "PRESENCE_CHECK_COMPLETE") {
    const { success, tabId, clickSessionId, processId } = msg;
    
    // Find associated click session for correlation
    let correlatedSession = null;
    if (clickSessionId) {
      correlatedSession = activeClickSessions.get(clickSessionId);
    }
    
    console.log(`[DEBUG_LOG] PRESENCE_CHECK_COMPLETE received from content script
Success: ${success}
Tab ID: ${tabId}
Click Session ID: ${clickSessionId || 'UNKNOWN'}
Process ID: ${processId || 'UNKNOWN'}
Tab Created: ${correlatedSession?.tabCreated || 'UNKNOWN'}
Tab Reused: ${correlatedSession?.tabReused || 'UNKNOWN'}
Timestamp: ${new Date().toISOString()}
Action: ${success ? 'SCHEDULING_TAB_CLEANUP' : 'KEEPING_TAB_FOR_DEBUG'}`);
    
    if (success && tabId) {
      // Close the tab after a short delay if the presence check was successful
      setTimeout(() => {
        chrome.tabs.remove(tabId, () => {
          if (chrome.runtime.lastError) {
            console.log(`[DEBUG_LOG] Tab cleanup failed: ${chrome.runtime.lastError.message}`);
          } else {
            console.log(`[DEBUG_LOG] TAB CLEANUP COMPLETED
Tab ID: ${tabId}
Click Session ID: ${clickSessionId || 'UNKNOWN'}
Process ID: ${processId || 'UNKNOWN'}
Cleanup Delay: 2000ms
Tab Management: AUTOMATIC_CLEANUP_AFTER_SUCCESS
Resource Usage: OPTIMIZED - Tab removed after completion
Timestamp: ${new Date().toISOString()}`);
          }
        });
      }, 2000); // 2 second delay to allow user to see the result
      
      // Update session status
      if (correlatedSession) {
        activeClickSessions.set(clickSessionId, {
          ...correlatedSession,
          status: 'COMPLETED_SUCCESS',
          completionTime: new Date().toISOString(),
          tabCleanupScheduled: true
        });
      }
    } else {
      // Keep tab open for debugging if there was an error
      console.log(`[DEBUG_LOG] TAB CLEANUP SKIPPED
Tab ID: ${tabId}
Reason: ${success ? 'UNKNOWN_ERROR' : 'PRESENCE_CHECK_FAILED'}
Action: Tab left open for debugging
Timestamp: ${new Date().toISOString()}`);
      
      // Update session status
      if (correlatedSession) {
        activeClickSessions.set(clickSessionId, {
          ...correlatedSession,
          status: 'COMPLETED_ERROR',
          completionTime: new Date().toISOString(),
          tabCleanupScheduled: false
        });
      }
    }
    
    sendResponse({ ok: true, status: success ? 'CLEANUP_SCHEDULED' : 'CLEANUP_SKIPPED' });
  }

  // NEW: Handle proxied fetch requests from content scripts
  if (msg?.type === "PROXY_FETCH") {
    const { url, options } = msg.payload;
    
    console.log(`[DEBUG_LOG] PROXY_FETCH received from content script
URL: ${url}
Timestamp: ${new Date().toISOString()}`);

    // The fetch call from the background script will automatically include
    // the HttpOnly SESSION_TOKEN cookie for the target domain.
    fetch(url, options)
      .then(response => {
        // Resolve the promise with status and data so the content script
        // knows if the call was successful.
        return response.text().then(text => ({
          status: response.status,
          statusText: response.statusText,
          data: text
        }));
      })
      .then(result => {
        console.log(`[DEBUG_LOG] PROXY_FETCH successful for ${url}. Status: ${result.status}`);
        sendResponse({ ok: true, response: result });
      })
      .catch(error => {
        console.error(`[DEBUG_LOG] PROXY_FETCH network error for ${url}: ${error.message}`);
        sendResponse({ ok: false, error: error.message });
      });

    return true; // Indicates we will send a response asynchronously.
  }

  if (msg?.type === "SCHEDULE_ALARM") {
    const { hour, minute, enabled } = msg.payload || {};
    chrome.alarms.clear(ALARM_NAME, () => {
      if (enabled) {
        // Schedule daily at roughly the specified local time
        const now = new Date();
        const next = new Date();
        next.setHours(hour, minute, 0, 0);
        if (next <= now) next.setDate(next.getDate() + 1);
        const when = next.getTime();
        chrome.alarms.create(ALARM_NAME, {
          when,
          periodInMinutes: 24 * 60
        });
      }
      sendResponse({ ok: true });
    });
    return true; // async response
  }
});

// NEW: Global, persistent listener for tab updates.
// This is more robust than the previous temporary listener.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Ensure the tab has finished loading and has a URL before proceeding.
  if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('https://e-pracownik.opi.org.pl/')) {
    
    // Check if this tab is part of a presence-check session we are currently managing.
    let correlatedSession = null;
    let clickSessionId = null;

    for (const [sessionId, sessionData] of activeClickSessions.entries()) {
      if (sessionData.tabId === tabId && sessionData.status === 'PROCESSING') {
        correlatedSession = sessionData;
        clickSessionId = sessionId;
        break;
      }
    }

    // If we found a matching session, it means this tab just finished loading
    // (either the login page or the home page) and needs to be processed.
    if (correlatedSession) {
      console.log(`[DEBUG_LOG] Monitored tab ${tabId} finished loading URL: ${tab.url}. Sending CHECK_IN message.`);
      
      chrome.tabs.sendMessage(tabId, {
        type: "CHECK_IN",
        clickSessionId: clickSessionId,
        processId: correlatedSession.processId,
        tabId: tabId
      }).catch(error => {
        // This can happen if the content script isn't ready, which is normal on some navigations.
        console.log(`[DEBUG_LOG] Suppressing benign error on sending CHECK_IN to tab ${tabId}: ${error.message}`);
      });
    }
  }
});
