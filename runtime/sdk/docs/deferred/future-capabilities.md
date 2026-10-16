# Deferred capabilities — beyond Expo parity, and unadopted Web APIs

Written 2026-10-16, after the operations audit (docs/operations.md)
declared interface-level parity with the Expo list. Everything here is
**deliberately not designed yet**: either it extends beyond what Expo
offers first-party (section 1, mined from popular third-party React
Native libraries), or it is a Web standard we measured but have not
adopted into lib.native-dom (section 2), or it is a small standard that
would need a hand-written MDN addition (section 3). Priority order
within each section is the recommendation from the discussion that
produced this file. When an item gets designed, delete its row and add
the module/ledger entries in the same change.

## 1. Capabilities Expo does not offer first-party (third-party RN ecosystem)

Source list: established native-capability libraries (ble-plx,
ble-manager, bluetooth-classic, nfc-manager, usb-serialport-for-android,
wifi-reborn, zeroconf, tcp-socket, react-native-webrtc, callkeep,
health-connect, healthkit, background-actions, background-geolocation,
google-cast, otp-verify, react-native-biometrics), checked against our
lib and modules on 2026-10-16.

Already covered here (no action): BLE central (Web Bluetooth), NFC
NDEF (Web NFC), USB/serial/HID (WebUSB/Web Serial/WebHID), WebRTC
(RTCPeerConnection in lib), background tasks (sdk:tasks), basic
background geolocation (sdk:location).

| Priority | Capability | Why the standard/SDK does not cover it | Proposed home |
|---|---|---|---|
| 1 | Wi-Fi management: scan, connect/disconnect, forget, current network detail | No Web standard; iOS only configures self-created networks, Android restricts scanning — the contract must carry those limits | `shared` module `wifi` |
| 2 | mDNS/Bonjour discovery + service advertisement | Browsers deliberately do not expose LAN discovery | `shared` module `discovery` |
| 3 | BLE peripheral mode (advertise, GATT server) | Web Bluetooth is central-only by spec | extension near `device`/its own `bluetooth-peripheral` |
| 4 | Bluetooth Classic / RFCOMM serial | No Web standard; iOS limited to MFi accessories | `shared` module with honest availability |
| 5 | Health records (HealthKit + Health Connect unified) | Two vendor stores, one typed records model worth designing carefully (types, units, permissions per record type) | `shared` module `health`; desktop mostly unsupported |
| 6 | VoIP system call integration (CallKit / ConnectionService) | WebRTC carries media, not the system call UI/lifecycle | `shared` module `calls` |
| 7 | Biometric-bound cryptographic keys (generate in Keystore/Keychain, sign with prompt) | WebAuthn is server authentication; local signing keys are a different contract | extension of `shared/security` |
| 8 | NFC beyond NDEF: APDU transceive (ISO-DEP), Mifare, host card emulation | Web NFC stops at NDEF by design | extension near NFC; HCE may stay projection-only |
| 9 | Foreground-service persistent tasks | `tasks` models OS-scheduled work; a user-visible always-running service (Android) is a different lifecycle | extension of `shared/tasks` |
| 10 | Motion-aware tracking extras: still/moving triggers, heartbeat, odometer | Options on `backgroundLocation`, not a new module | extension of `shared/location` |
| 11 | SMS OTP retrieval | WebOTP (below) covers Android's retriever model | lib addition first, SDK wrapper only if insufficient |

Deliberately not SDK additions: raw TCP/UDP sockets belong to the Node
layer (`node:net`/`node:dgram` in runtime/node); Google Cast's sender
protocol is proprietary (Remote Playback, below, is the standard part).

## 2. Measured but unadopted Web standards

Closure costs measured against lib.dom 7.0.2 with
tools/extract-native-dom.py (declarations/lines beyond the step-3
base). Adopting is cheap; each still wants a per-target conformance
stance when adopted.

| API | Cost | Note |
|---|---|---|
| Remote Playback | +4 / +54 | The standard half of casting |
| Web MIDI | +16 / +240 | Clean closure; `MIDIAccess` |
| WebTransport | +9 / +159 | QUIC streams/datagrams |
| WebGPU | +151 / +1,464, DOM texture-source refs | Deferred by decision; graphics surface is its own round (Dawn/wgpu provider) |
| PaymentRequest | +23 / +363 | Store payment flows diverge per platform |
| CookieStore | +10 / +102 | Cookies belong to the HTTP layer |

## 3. Standards absent from lib.dom (hand-written MDN addition needed)

| API | Why it may matter |
|---|---|
| WebXR (`XRSystem` …) | Large surface (sessions, spaces, input, layers) and an OpenXR-sized provider per platform; Blink provides it on the Chromium host meanwhile. Its own round when XR is a product goal |
| WebOTP (`OTPCredential`) | Small; unblocks SMS verification codes (section 1, item 11) |
| ScreenDetails / ScreenDetailed (Window Management) | The standard form of multi-display detail; would let `desktop/displays` align field names with the spec |
| Presentation API | Second-screen presentation; mostly superseded by Remote Playback for media |
| Document Picture-in-Picture | Requires a document; UI-layer concern in DOM hosts only |
| NavigatorUAData | UA client hints; low value natively (`app.device` answers directly) |

## 4. Implementation-strategy note tied to this list

Per the agreed strategy: native targets implement Web contracts from
runtime/web-platform code + direct OS wrapping + embedded engines
(libwebrtc, FFmpeg, Dawn) behind providers; the Chromium host gets
Blink's implementations; browser/Wasm uses the host browser. Nothing in
sections 1–3 changes that; section 1 items are OS wrapping with no Web
contract to reuse, which is precisely why they are SDK modules.
