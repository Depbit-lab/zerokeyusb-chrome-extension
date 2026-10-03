// ZeroKeyUSB Web Link — popup logic.
//
// Flow when the toolbar icon is clicked:
//   1. Read the active tab's URL and derive the first letter of its domain.
//   2. Find the ZeroKeyUSB serial port (identified by a ZK PING/PONG handshake,
//      so we don't depend on a specific USB VID/PID).
//   3. Send "FIND <letter>" — the device jumps its alphabet search to that
//      letter. The user picks the site on the device.
//   4. Focus the page's username/email field so everything is ready for the
//      device to type the credential over HID.
//
// The password never touches the browser: the extension only sends a
// navigation hint and focuses a field; the device types via HID on a physical
// press.

const els = {
  status: document.getElementById("status"),
  connect: document.getElementById("connect"),
  hint: document.getElementById("hint"),
};

function setStatus(text, cls) {
  els.status.textContent = text;
  els.status.className = cls || "";
}

// Tell the service worker to update the toolbar badge (green = linked & on,
// grey = disabled or not linked).
function reportState(state) {
  try { chrome.runtime.sendMessage({ type: "zk-state", state }); } catch {}
}

// Common two-level public suffixes so "example.co.uk" resolves to "example",
// not "co". (Best-effort without the full Public Suffix List.)
const TWO_LEVEL_TLDS = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "ltd.uk", "plc.uk",
  "com.au", "net.au", "org.au", "co.nz", "co.za",
  "com.br", "com.mx", "com.ar", "co.in", "com.sg", "com.hk",
  "co.jp", "or.jp", "ne.jp", "com.tr", "com.tw",
]);

// The registrable label of a hostname: the MAIN domain, ignoring any
// subdomain(s). ss.revolut.com -> "revolut", doc.zerokeyusb.com -> "zerokeyusb",
// www.example.co.uk -> "example". This is the label right before the public
// suffix, which is the letter that matters for the on-device search.
function registrableLabel(hostname) {
  const h = (hostname || "").toLowerCase().replace(/\.$/, "");
  const parts = h.split(".").filter(Boolean);
  if (parts.length <= 2) return parts[0] || "";
  const lastTwo = parts.slice(-2).join(".");
  const tldLabels = TWO_LEVEL_TLDS.has(lastTwo) ? 2 : 1;
  return parts[parts.length - 1 - tldLabels] || "";
}

// Send one line and wait for a response line starting with `expectPrefix`.
async function sendAndAwait(port, command, expectPrefix, timeoutMs = 1500) {
  const writer = port.writable.getWriter();
  await writer.write(new TextEncoder().encode(command + "\n"));
  writer.releaseLock();

  const reader = port.readable.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const chunk = await Promise.race([
        reader.read(),
        new Promise((r) => setTimeout(() => r({ value: undefined, done: false }), 200)),
      ]);
      if (chunk.done) break;
      if (chunk.value) {
        buf += decoder.decode(chunk.value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const ln of lines) {
          const t = ln.trim();
          if (t.startsWith(expectPrefix)) return t;
        }
      }
    }
  } finally {
    try { await reader.cancel(); } catch {}
    reader.releaseLock();
  }
  return null;
}

// Open the port, run one command, close. Each command gets a fresh session so a
// cancelled reader from a previous command can't break the next one (reusing a
// cancelled Web Serial reader is unreliable).
async function sendCommand(port, command, expectPrefix, timeoutMs = 1500) {
  await port.open({ baudRate: 115200 });
  try {
    return await sendAndAwait(port, command, expectPrefix, timeoutMs);
  } catch (e) {
    return null;
  } finally {
    try { await port.close(); } catch {}
  }
}

// Confirm a candidate port is a ZeroKey via ZK PING; returns "ON"/"OFF" or null.
async function probePort(port) {
  const pong = await sendCommand(port, "ZK PING", "ZK PONG", 1200);
  return pong ? (pong.includes("ON") ? "ON" : "OFF") : null;
}

// Look through already-granted ports for the ZeroKey. Returns {port, state} or
// null. The matching port stays open for the caller.
async function findZeroKey() {
  const ports = await navigator.serial.getPorts();
  for (const p of ports) {
    const state = await probePort(p);
    if (state) return { port: p, state };
  }
  return null;
}

// Injected into the page (in every frame): focus the most likely
// username/email field so the device's user+TAB+password output lands in the
// right place.
//
// The focus is DEFERRED with a short retry loop. When this runs, the extension
// popup is still closing and the page does not yet have focus — a programmatic
// .focus() on an unfocused document is ignored by the browser. By the time the
// timeout fires the popup has closed and the page is focused, so the caret
// actually lands in the field. It retries a few times for slow/SPA logins.
function focusLoginFieldDeferred() {
  const isVisible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 &&
           s.visibility !== "hidden" && s.display !== "none";
  };
  const selectors = [
    'input[autocomplete="username"]',
    'input[autocomplete="email"]',
    'input[type="email"]',
    'input[name*="user" i]',
    'input[id*="user" i]',
    'input[name*="email" i]',
    'input[id*="email" i]',
    'input[name*="login" i]',
  ];
  const pick = () => {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (isVisible(el)) return el;
    }
    // Classic login form: the text input in a form that also has a password.
    const pw = document.querySelector('input[type="password"]');
    if (pw && pw.form) {
      const cand = pw.form.querySelectorAll(
        'input[type="text"], input[type="email"], input:not([type])'
      );
      for (const el of cand) if (isVisible(el)) return el;
    }
    // Last resort: the first visible text-ish input on the page.
    const all = document.querySelectorAll(
      'input[type="text"], input[type="email"], input:not([type])'
    );
    for (const el of all) if (isVisible(el)) return el;
    return null;
  };
  let tries = 0;
  const attempt = () => {
    const el = pick();
    if (el) {
      el.focus({ preventScroll: false });
      // Some frameworks only "activate" a field on a pointer event.
      try { el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); } catch {}
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    if (++tries < 12) setTimeout(attempt, 150);
  };
  setTimeout(attempt, 120);
}

async function run(port, state, tab, letter) {
  if (state === "OFF") {
    reportState("off");
    setStatus("Link disabled on device.", "warn");
    els.hint.innerHTML =
      'Enable it on the device: <b>Menu → Tools → Chrome: On</b>.';
    try { await port.close(); } catch {}
    return;
  }
  reportState("on");

  // Sync the device clock (UTC Unix seconds) so TOTP codes stay accurate — the
  // same value the webtool/time-sync tool sends, pushed here on every use.
  // Best-effort: ignore the result.
  await sendCommand(port, "TIME " + Math.floor(Date.now() / 1000), "OK TIME", 1200);

  if (!letter) {
    setStatus("Time synced. Couldn't read a domain from this tab.", "warn");
    return;
  }

  const ok = await sendCommand(port, "FIND " + letter, "OK FIND", 1500);

  if (!ok) {
    setStatus("Device didn't jump (locked, or in a menu?).", "warn");
    els.hint.textContent =
      "Unlock the device and stay on the credentials list, then try again.";
    return;
  }

  setStatus("Jumped to '" + letter.toUpperCase() + "' on the device.", "ok");

  // Inject the deferred field-focus into every frame (login forms are often in
  // a cross-origin iframe), then close the popup so the page regains focus and
  // the deferred .focus() lands with a visible caret.
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: focusLoginFieldDeferred,
    });
  } catch {
    // allFrames can be blocked by permissions on some pages; fall back to the
    // top frame, which is where the login form usually lives anyway.
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: focusLoginFieldDeferred,
      });
    } catch {}
  }

  window.close();
}

async function main() {
  if (!("serial" in navigator)) {
    setStatus("Web Serial not available in this browser.", "err");
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let hostname = "";
  try { hostname = new URL(tab.url).hostname; } catch {}
  const letter = (registrableLabel(hostname)[0] || "").toLowerCase();

  const found = await findZeroKey();
  if (found) {
    setStatus("Device linked.", "ok");
    await run(found.port, found.state, tab, letter);
    return;
  }

  // No granted ZeroKey port yet — offer a one-time connect. The port chooser
  // must be opened from a real tab: calling navigator.serial.requestPort() here
  // would dismiss this popup (which cancels the request), so we open the
  // dedicated connect page instead.
  reportState("none");
  setStatus("No ZeroKeyUSB linked yet.", "warn");
  els.connect.style.display = "block";
  els.hint.textContent =
    "Opens a one-time setup page to pick the ZeroKeyUSB port; it is remembered afterwards.";
  els.connect.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("connect.html") });
    window.close();
  });
}

main();
