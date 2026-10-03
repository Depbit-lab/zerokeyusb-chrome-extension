// ZeroKeyUSB Web Link — one-time port grant page.
//
// Runs in a normal tab (not the action popup) so navigator.serial.requestPort()
// works: the serial port chooser would dismiss the popup and cancel the request,
// but a full tab keeps focus.

const btn = document.getElementById("connect");
const status = document.getElementById("status");

function setStatus(text, cls) {
  status.textContent = text;
  status.className = cls || "";
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

btn.addEventListener("click", async () => {
  if (!("serial" in navigator)) {
    setStatus("Web Serial is not available in this browser.", "err");
    return;
  }

  let port;
  try {
    port = await navigator.serial.requestPort();
  } catch (e) {
    setStatus("No port was selected.", "warn");
    return;
  }

  setStatus("Verifying the device…");
  try {
    await port.open({ baudRate: 115200 });
    let pong;
    try {
      pong = await sendAndAwait(port, "ZK PING", "ZK PONG", 1500);
    } finally {
      try { await port.close(); } catch {}
    }
    if (pong) {
      const state = pong.includes("ON") ? "enabled" : "disabled (turn it on in Tools → Chrome)";
      setStatus("✓ ZeroKeyUSB linked! Link is " + state +
                ". You can close this tab and use the toolbar icon.", "ok");
    } else {
      setStatus("Port opened, but the device didn't answer 'ZK PING'. " +
                "Make sure the updated firmware is flashed and the device is on.", "warn");
    }
  } catch (e) {
    setStatus("Couldn't open the port: " + (e && e.message ? e.message : e), "err");
  }
});
