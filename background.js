// ZeroKeyUSB Web Link — service worker.
//
// MV3 service workers cannot access navigator.serial, so live device detection
// (to grey the icon out) happens in the popup, which reports the result here so
// we can reflect it on the toolbar badge.
//
//   badge "" (none)  → unknown / not checked yet
//   badge green dot  → ZeroKeyUSB linked and enabled
//   badge grey dot   → device seen but link disabled, or not linked
//
// This is a pragmatic stand-in for full live icon greying; see README for the
// offscreen-document upgrade that keeps it live even without opening the popup.

function setBadge(state) {
  // state: "on" | "off" | "none"
  const color = state === "on" ? "#128a3a" : "#999999";
  const text = state === "none" ? "" : "●";
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "zk-state") {
    setBadge(msg.state);
  }
});

chrome.runtime.onInstalled.addListener(() => setBadge("none"));
