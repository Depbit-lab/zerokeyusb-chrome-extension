# ZeroKeyUSB Web Link (Chrome extension)

A minimal Chrome/Edge extension that, on a single click, tells a connected
**ZeroKeyUSB** to jump its on-device alphabet search to the site of the current
tab, and focuses the page's login field so the credential is ready to be typed.

## What it does

1. Reads the active tab's URL and takes the **first letter** of its main domain,
   ignoring subdomains (`accounts.google.com` → `g`, `www.example.co.uk` → `e`).
2. Talks to the device over **Web Serial** (the same USB CDC port used by the
   webtool). It identifies the ZeroKeyUSB with a `ZK PING` → `ZK PONG` handshake,
   so it does not depend on a specific USB VID/PID.
3. Sends `FIND <letter>`; the device switches to its alphabet-search screen at
   that letter. **You pick the matching site on the device.**
4. Focuses the username/email field on the page so the device's
   *user + TAB + password* output lands in the right place.

## Security model

The extension **never sees or handles the password**. It only:

- reads the tab URL,
- sends a *navigation hint* (one letter) to the device, and
- focuses an input field.

The credential is typed by the device over **USB HID**, only after you
**physically select the site and press** on the device. A malicious page or
host can, at most, move the on-device search cursor — it cannot extract or
inject a credential. The firmware also:

- ignores `FIND` entirely unless **Tools → Chrome: On** is enabled (default on),
- ignores it unless the vault is **unlocked and on the credentials list** (never
  during PIN entry, an edit, the menu or TOTP), and
- only ever navigates — the link adds **no serial command that types or reveals**
  a credential. (The only path by which credentials leave the device over USB is
  the WebTool backup `EXPORT`, which the extension never sends and which needs an
  unlocked vault plus a physical long press on the device to authorize.)

## Firmware protocol (app mode, USB CDC @ 115200)

```
Host → Device      Device → Host
ZK PING            ZK PONG ON | ZK PONG OFF        (always answered)
FIND <letter>      OK FIND <letter>                (jumped)
                   ERR OFF     (Chrome link disabled in Tools)
                   ERR BUSY    (locked, or not on the credentials list)
                   ERR EMPTY   (vault has no credentials)
                   ERR ARG     (no letter supplied)
```

## Install (unpacked)

Download this repository (**Code → Download ZIP**) and unzip it, then:

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select this `chrome-extension/` folder.
3. Click the toolbar icon → **Connect ZeroKeyUSB…**. This opens a one-time setup
   tab where you pick the ZeroKeyUSB port (**one-time grant**, remembered after).

> The grant must happen on the setup tab, not the popup: opening the OS serial
> port chooser dismisses the action popup, which cancels the request. The setup
> page is a normal tab, so the chooser works there. Web Serial permissions are
> also **per-origin** — granting the port to the webtool does not grant it to
> this extension; it needs its own.

The toolbar badge shows a green dot when the device is linked and enabled, and a
grey dot when it is not linked or the link is disabled.

## Known limitations / possible enhancements

- **Live icon greying without opening the popup** needs an MV3
  *offscreen document* holding `navigator.serial` and listening for
  `connect`/`disconnect` events (service workers can't use Web Serial). The
  current build updates the badge each time the popup runs, which is enough for
  the common flow.
- **Field detection** uses heuristics (`autocomplete=username`, `type=email`,
  name/id contains user/email/login, or the text input in a form with a
  password field). Some SPAs, shadow DOM and cross-origin iframes won't match —
  the same limitation every password manager has.
- **Phase 2:** send the full domain (`FIND google.com`) and have the firmware
  filter by prefix instead of only by first letter, for a more precise jump.

## License

MIT — see [LICENSE](LICENSE). Part of the [ZeroKeyUSB](https://zerokeyusb.com)
project; firmware and hardware live in
[Depbit-lab/Zerokey](https://github.com/Depbit-lab/Zerokey).
