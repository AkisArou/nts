# Coverage ledger — Expo concepts vs this platform

Every module on the agreed Expo list (76, supplied 2026-10-16) appears
exactly once. `tools/check-coverage.py` enforces that, and verifies each
`lib:X` citation exists in `lib.native-dom.d.ts` and each `sdk:x` module
exists on disk. A row is a **disposition**, not a promise of parity:
parity is checked operation-by-operation when a module is implemented.

Maps/geocoding are likewise out of scope for now (decided 2026-10-16); the draft interface is parked in docs/deferred/maps.d.ts.

Dispositions: `web-standard` (global in the native lib) · `sdk-gap`
(our module) · `native-projection` (generated OS API) · `build/config`
(product config owns it) · `ui-layer` (React components) ·
`node-layer` (runtime/node, parked for this package) · `out-of-scope`.

Status: `covered` (interface exists) · `partial` · `lib-gap` (standard
exists, seed/addition pending — DESIGN step 3) · `gap-missing` (SDK
module to write — step 4) · `recorded` (disposition is the resolution).

| Expo module | Disposition | Served by | Status | Next action |
|---|---|---|---|---|
| Accelerometer | web-standard | `lib:Accelerometer` | covered | — |
| AgeRange | native-projection | Declared Age Range / Play age signals via projections | recorded | Revisit if a portable age-signal contract emerges |
| AppIntegrity | native-projection | Play Integrity / App Attest via projections | recorded | Candidate `security` extension once both shapes are read side by side |
| AppIntents | native-projection | Apple App Intents / Android App Actions | recorded | — |
| AppleAuthentication | sdk-gap | `sdk:auth` | covered | Via the generic system-browser OAuth flow |
| Application | sdk-gap | `sdk:app` | covered | — |
| Asset | build/config | Product resources in nts.config; loaded via fetch/`documents` | recorded | Resource story belongs to the build lane's config doc |
| Audio (expo-audio) | sdk-gap | `lib:MediaRecorder` + `sdk:media` | covered | Recording is standard; Web Audio adopted step 3 (+76/+1474); playback player added in `sdk:media` |
| AuthSession | sdk-gap | `sdk:auth` | covered | — |
| BackgroundTask | sdk-gap | `sdk:tasks` | covered | — |
| Barometer | sdk-gap | `sdk:device` extension | covered | Added step 4 |
| Battery | web-standard | `lib:BatteryManager` | covered | MDN addition in lib |
| Blob | web-standard | `lib:Blob` | covered | — |
| BlurView | ui-layer | React components | recorded | — |
| Brightness | sdk-gap | `sdk:device` extension | covered | Added step 4 |
| BuildProperties | build/config | nts.config product definition | recorded | — |
| Calendar | sdk-gap | `sdk:calendar` | covered | — |
| Camera | web-standard + sdk-gap | `lib:MediaDevices` `lib:ImageCapture` `sdk:camera` | covered | CameraView itself is ui-layer |
| Cellular | sdk-gap | `sdk:network` | covered | As `NetworkState.cellular` |
| Checkbox | ui-layer | React components | recorded | — |
| Clipboard | web-standard + sdk-gap | `lib:Clipboard` `lib:ClipboardItem` `lib:ClipboardChangeEvent` `sdk:clipboard` | covered | Complement covers no-prompt type peeking and sensitive writes only |
| Constants | build/config + sdk-gap | `sdk:app` + product config | recorded | Manifest-style constants are config exports, not runtime API |
| Contacts | web-standard + sdk-gap | `lib:ContactsManager` `sdk:contacts` | covered | — |
| Crypto | web-standard | `lib:Crypto` `lib:SubtleCrypto` | covered | — |
| Device | sdk-gap | `sdk:app` | covered | DeviceInfo + platform facts |
| DeviceMotion | web-standard | `lib:DeviceMotionEvent` `lib:Accelerometer` | covered | — |
| DocumentPicker | sdk-gap | `sdk:documents` | covered | — |
| FileSystem | web-standard + sdk-gap | `lib:FileSystemDirectoryHandle` `lib:FileSystemObserver` `sdk:documents` | covered | Every expo-file-system concept has a home (OPFS, grants, resumable downloads, watching). The path-string *shape* is deliberately not replicated |
| Fingerprint | sdk-gap | `sdk:security` | covered | Legacy name for biometrics |
| Font | web-standard | `lib:FontFace` `lib:FontFaceSet` | covered | Adopted step 3 (+9 decls/+183 lines). Font-set registration (document.fonts on web) is UI-layer territory natively |
| GlassEffect | ui-layer | React components | recorded | — |
| Gyroscope | web-standard | `lib:Gyroscope` | covered | — |
| Haptics | sdk-gap | `sdk:device` | covered | Watch Web Haptics draft |
| Hinge | web-standard | `lib:DevicePosture` | covered | Adopted step 3 as MDN addition (absent from lib.dom). Viewport segments are CSS; UI layer |
| Image | ui-layer | React components; decode via `lib:ImageBitmap` | recorded | — |
| ImageManipulator | sdk-gap | `sdk:images` | covered | — |
| ImagePicker | sdk-gap | `sdk:photos` `sdk:camera` | covered | — |
| IntentLauncher | native-projection | Android intents via projection | recorded | Generic outbound open is `sdk:linking` |
| KeepAwake | web-standard | `lib:WakeLock` | covered | — |
| LightSensor | web-standard | `lib:AmbientLightSensor` | covered | — |
| LinearGradient | ui-layer | React components | recorded | — |
| Linking | sdk-gap | `sdk:linking` `sdk:app` | covered | Inbound = app URL events |
| LivePhoto | sdk-gap | `sdk:photos` extension | covered | `isLivePhoto` + paired clip on MediaAsset, step 4 |
| LocalAuthentication | sdk-gap | `sdk:security` | covered | — |
| Localization | web-standard + sdk-gap | Intl + `sdk:locale` | covered | Temperature/24-hour/first-weekday from `sdk:locale`; formatting from Intl |
| Location | web-standard + sdk-gap | `lib:Geolocation` `sdk:location` | covered | — |
| Magnetometer | web-standard | `lib:Magnetometer` | covered | — |
| MailComposer | sdk-gap | `sdk:compose` | covered | — |
| Manifests | build/config | Product manifest in nts.config | recorded | — |
| MediaLibrary | sdk-gap | `sdk:photos` | covered | — |
| MeshGradient | ui-layer | React components | recorded | — |
| NavigationBar | ui-layer | System-UI surface of the UI layer | recorded | — |
| Network | web-standard + sdk-gap | `lib:NetworkInformation` `sdk:network` | covered | — |
| Notifications | web-standard + sdk-gap | `lib:Notification` `sdk:notifications` | covered | — |
| Observe | out-of-scope | Swift Observation bridge experiment | recorded | No portable app concept identified; revisit with evidence |
| Pedometer | sdk-gap | `sdk:device` | covered | — |
| Print | sdk-gap | `sdk:printing` | covered | — |
| ScreenCapture | web-standard + sdk-gap | `lib:MediaDevices` (getDisplayMedia) `sdk:capture` `sdk:screen-protection` | covered | Prevention + screenshot/recording reporting in `sdk:screen-protection` |
| ScreenOrientation | web-standard | `lib:ScreenOrientation` | covered | Adopted step 3 (+4/+46), reached via trimmed `lib:Screen` |
| SecureStore | sdk-gap | `sdk:security` | covered | — |
| Sensors | web-standard | `lib:Sensor` | covered | Umbrella module; each sensor is its global |
| Sharing | web-standard | `lib:ShareData` (navigator.share) | covered | — |
| SMS | sdk-gap | `sdk:compose` | covered | — |
| Speech | web-standard | `lib:SpeechSynthesis` `lib:SpeechRecognition` | covered | Recognition added as MDN-sourced addition (round 2) |
| SplashScreen | build/config | Launch screen in product config | recorded | Runtime hold/release may become a small app extension; undecided |
| SQLite | node-layer | `node:sqlite` in runtime/node | recorded | Out of this package by current scope |
| StatusBar | ui-layer | System-UI surface of the UI layer | recorded | — |
| StoreReview | sdk-gap | `sdk:store` | covered | Billing deliberately not started |
| Symbols | ui-layer | Icon components (SF Symbols etc.) | recorded | — |
| SystemUI | ui-layer | System-UI surface of the UI layer | recorded | — |
| TaskManager | sdk-gap | `sdk:tasks` | covered | — |
| TrackingTransparency | native-projection | iOS ATT via projection | recorded | Candidate extra `AppPermissionName`; undecided |
| Updates | build/config | Store updates / product delivery, not OTA JS | recorded | AOT platform: no JS-bundle update channel to mirror |
| Video (expo-video) | sdk-gap | `sdk:media` | covered | VideoView itself is ui-layer |
| WebBrowser | sdk-gap | `sdk:browser` `sdk:auth` | covered | — |
| Widgets | out-of-scope | — | recorded | Out of scope for now (decided 2026-10-16); revisit with the React lane if ever |

## Web API adoption decisions (step 3, measured 2026-10-16)

Closure costs measured with the extractor against lib.dom 7.0.2 (decls/lines
added beyond the 420-decl/6,626-line base). Adopted into the lib:
ScreenOrientation (+4/+46), SpeechSynthesis (+10/+252), MediaSession
(+9/+109), WebAudio (+76/+1,474, one recorded patch removing
`createMediaElementSource`), WebCodecs (+54/+655), IndexedDB (+27/+714),
WebRTC (+82/+1,083), Gamepad (+7/+122), Scheduler (+4/+32), URLPattern
(+6/+108), FontFace (+9/+183). Absent from lib.dom and added as MDN-sourced
additions instead: NetworkInformation, DevicePosture.

Deferred with reasons (revisit per round, not silently absent): WebGPU
(+151/+1,464 and DOM-tree texture sources — graphics surface is a separate
decision), PaymentRequest (+23/+363 — store payment flows differ),
CookieStore (+10/+102 — cookie handling belongs to the HTTP layer),
WebTransport (+9/+159 — niche), Bluetooth/USB/Serial/HID/NFC plus Compute Pressure, Idle Detection,
EyeDropper, Keyboard, Launch Handler, and FileSystemObserver were since
added as MDN-sourced round-2 additions (2026-10-16), keeping each spec's
chooser/permission behavior; presence in the lib is typing, not an
implementation claim per target.
