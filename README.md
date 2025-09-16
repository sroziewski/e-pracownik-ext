# e-pracownik-ext
_A small Chrome / Chromium extension that automates “I’m present” check-in on the **e-Pracownik** employee portal and adds rich debug logging._

---

## ✨ Features
* **One-click “Check presence”** – opens *https://e-pracownik.opi.org.pl/#/home*, logs-in (form or API), and clicks the “mark presence” button if you are not already registered for the current day.
* **Auto-check scheduler** – optional daily alarm (default 08 : 05) that runs the presence check in the background.
* **Smart authentication**
    * Primary: direct `/api/auth/login` call with `credentials: "include"`.
    * Fallback: classic form filling when the SPA login page is shown.
    * Global 30-second cooldown to avoid duplicate logins.
* **Robust session handling** – verifies `SESSION_TOKEN` via the `chrome.cookies` API and skips re-authentication while it is still valid.
* **Extensive DEBUG_LOG console output** – every HTTP request is correlated with the originating click / process, showing status, endpoint type, auth state, etc.
* **Dev-friendly test suite** (see `scripts/test_*.js`) to prove cookie extraction, auth cooldown, logging coverage, etc.

---

## 🧩 Installation

1. Clone / download the repository.
2. Run `npm install` to fetch `sharp` (used only by the SVG->PNG icon generator).
3. In Chrome / Edge / Brave:
    * `chrome://extensions` → enable “Developer mode”.
    * “Load unpacked” → select the `e-pracownik-ext` folder.
4. Fill in your **username** and **password** in the extension’s Options page.  
   The data is stored in `chrome.storage.local` only.

---

## 🚀 Usage

| Action | Where | Result |
| ------ | ----- | ------ |
| Click the toolbar icon | Popup | Runs “Check presence” immediately. |
| Tick “Enable daily auto-check” and choose a time | Options | Creates a browser alarm; the service-worker will run the check each day. |
| Observe logs | `chrome://extensions` → “Service worker” → “Inspect” | Rich `[DEBUG_LOG] …` output shows every step (auth, requests, cookie verification, presence click). |

**Tip:** If you develop against the real system, keep DevTools open on the background service-worker _and_ the newly created tab – you will see both sides of the correlation.

---

## 🛠️ Development
