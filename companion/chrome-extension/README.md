# Kuro Companion — Active Tab Chrome Extension

A privacy-preserving browser extension that enables Kuro to react autonomously to your active development and learning contexts.

---

## 🔒 Privacy & Least-Privilege Architecture
- **Permissions:** Only `"tabs"` and `"storage"`.
- **Zero Content Scraping:** Never reads page text, DOM elements, cookies, form fields, passwords, or clipboard.
- **Zero Full History:** Does not log or store browsing history.
- **Built-in Automatic Exclusions:** Automatically ignores `localhost`, `127.0.0.1`, banking domains (`*bank*`, `chase.com`, `paypal.com`), and authentication endpoints (`accounts.google.com`, `login.*`, `auth.*`).
- **Loopback-Only Communication:** Sends minimal metadata (`hostname` + top-level page `title`) strictly to your local desktop companion at `http://127.0.0.1:48199/api/browser/tab`.

---

## 🛠️ Installation Instructions (Chrome / Brave / Edge)

1. Open your browser and navigate to the extensions management page:
   - **Chrome:** `chrome://extensions`
   - **Brave:** `brave://extensions`
   - **Edge:** `edge://extensions`
2. Enable **Developer mode** (toggle switch in the top-right or left sidebar).
3. Click **Load unpacked** (top-left button).
4. Browse to your Kuro repository directory and select the folder:
   ```
   f:\smart-pet-assistant-web\companion\chrome-extension
   ```
5. The extension **Kuro Companion — Active Tab Bridge** will now appear in your browser toolbar.
6. Click the extension icon and toggle **Share Active Domain** to enable browser awareness.

---

## ⚙️ Testing & Verification Status
- **Current Status:** Tested via unit tests for domain extraction, categorization, and privacy exclusions.
- **Live Chrome Execution:** Marked as **NOT FULLY VERIFIED** until manually loaded in your active browser instance.
