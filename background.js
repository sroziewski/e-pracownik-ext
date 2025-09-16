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

  const tab = await new Promise((resolve) => {
    chrome.tabs.create({ url: TARGET_URL, active: false }, resolve);
  });

  const tabId = tab.id;
  console.log(`[DEBUG_LOG] Created new tab for presence check
Tab ID: ${tabId}
Tab URL: ${tab.url}
Process ID: ${processId}
Click Session ID: ${clickSessionId || 'AUTO_SCHEDULED'}
Timestamp: ${new Date().toISOString()}`);

  // Wait for the page to finish loading before messaging the content script
  const onUpdated = (updatedTabId, info) => {
    if (updatedTabId === tabId && info.status === "complete") {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.sendMessage(tabId, { 
        type: "CHECK_IN",
        clickSessionId: clickSessionId,
        processId: processId
      });
    }
  };
  chrome.tabs.onUpdated.addListener(onUpdated);

  // Safety timeout: if load event missed, try after 15s
  setTimeout(() => {
    chrome.tabs.sendMessage(tabId, { 
      type: "CHECK_IN",
      clickSessionId: clickSessionId,
      processId: processId
    });
  }, 15000);
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
