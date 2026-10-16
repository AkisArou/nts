# Operations audit — Expo SDK 58 vs this platform

Module-level coverage is in [coverage.md](coverage.md). This file is the
operation-level audit behind calling those rows covered: every public
operation of the mined Expo modules is assigned a home here. Sources are
the module pages under https://docs.expo.dev/versions/latest/sdk/
(fetched as Markdown 2026-10-16). Legend: **W** = Web standard in
lib.native-dom · **S** = `@nts/sdk` SDK module · **C** = composition of
standards (no API needed) · **B** = build/config · **U** = UI layer ·
**P** = native projection / platform-only by design · **—** = deliberate
non-goal recorded inline.

## Mined in full (this audit)

| Expo module | Operations → home | Exceptions / notes |
|---|---|---|
| Camera | preview/takePicture/record/zoom/torch/flash/lenses/sizes → **W** getUserMedia, ImageCapture, MediaRecorder, track capabilities/constraints; barcode one-shot → **W** BarcodeDetector; continuous scan → **S** camera.barcodeScanner; permissions → **S** permissions | Document scanner & system scanner UI → **S** camera.scanDocument/scanBarcode, added from this audit. CameraView → **U**. `toggleRecordingAsync` availability probes → **S** availability() |
| MediaLibrary | getAssets+querying/filter/sort → **S** photos.query; asset info/EXIF/location/favorite → **S** MediaAsset.info/setFavorite (added); create/save/delete assets → **S** photos.save, MediaAsset.delete (added); albums CRUD, add/remove assets → **S** Album (added); change listener → **S** photos "change" (added); permissions picker (limited) → **S** permissions `limited`; moments/smart albums → **S** Album.isSmart | Live-photo pairing → **S** MediaAsset.livePhotoVideo. Migration APIs are Expo-internal → **—** |
| ImagePicker | launchImageLibrary/launchCamera → **S** photos.pick/camera.capturePhoto; options (mediaTypes, quality, allowsEditing+aspect, videoMaxDuration, selectionLimit) → **S** PickMediaOptions (added) | base64 result → **C** FileReader on the Blob. Pending-result (Android process death) → provider concern, recorded |
| Notifications | schedule/cancel/list/nextTrigger → **S** notifications; present now → **W** Notification; badge get/set → **S** + **W** setAppBadge; tokens → **S** getPushToken (names APNs/FCM); topics → **S** subscribeToTopic (added); channels/groups → **S** setChannel (added); categories → **S** setCategory (added); delivered/dismiss → **S** (added); received/response listeners → **S** events/initialResponse; dropped listener → **P** (APNs/FCM internals) | Expo Push Token is Expo's service → **—** (a provider backend, not an API). Exact-alarm permission → availability/permissions "notifications" note for providers |
| Location | current/watch/lastKnown → **W** Geolocation; heading → **S** motion.watchHeading (added); background updates → **S** backgroundLocation via tasks; geofencing → **S** geofencing; provider status/services enabled → **S** availability | geocode/reverseGeocode → **out of scope** with maps (parked). Motion activity → **S** motion (added) |
| Audio | play/pause/seek/rate/volume/loop/status → **S** media.AudioPlayer; playlist ops → **S** createAudioPlaylist (added); lock-screen controls → **W** MediaSession; record/inputs/status → **W** MediaRecorder+getUserMedia; audio sampling/stream → **W** Web Audio AnalyserNode/AudioWorklet; preload → **C** create player early | Recording presets are MediaRecorder options |
| Video | player ops incl. buffering, seek, rate, tracks (audio/subtitle), live, PiP capability → **S** media.VideoPlayer (tracks added); now-playing notification → **W** MediaSession + **S** notifications | VideoView incl. fullscreen/PiP surface → **U**. AirPlay button → **U/P**. Thumbnails → **C/S** images (frame via VideoFrame) |
| FileSystem | File/Directory read/write/CRUD/list/info/copy/move → **W** OPFS handles `getFile`/`createWritable` iterators; pick → **S** documents.open; download (resumable, background, savable) → **S** downloads (added); upload → **C** fetch; watch → **W** FileSystemObserver (added round 2); Paths (cache/document/bundle, disk space) → **W** OPFS + **S** documents.knownFolder + `navigator.storage.estimate()`; digest/md5 → **W** crypto.subtle (md5 not in SubtleCrypto — **—** deliberately, use SHA) | Path-string shape not replicated. Sync variants → **—** (async-only rule, DESIGN §3). Preview (QuickLook) → documents/shell open, recorded |
| Contacts | get/query/paged/byId → **S** contacts; add/update/remove → **S**; groups + containers (iOS) → **S** ContactGroup (added); present form → **S** presentForm (added); pickers → **W** Contact Picker + limited-access picker = permissions `limited`; share/writeToFile (vCard) → **S** toVCard (added) + **W** share; change listener → **S** "change" (added) | Field-selection projection (`fields` param) is an optimization, not semantics |
| Calendar | calendars CRUD/default/sources → **S** (added); events CRUD/list → **S**; attendees CRUD → **S** attendees (added); reminders CRUD → **S**; system event editor/view → **S** presentEventEditor (added); write-only permission → **S** permissions | Sync getters → async-only rule |
| Clipboard | get/set string → **W** readText/writeText; get/set image → **W** read()+ClipboardItem.getType / write([ClipboardItem]) with a Blob (no base64 round-trip); get/set URL → **W** `text/uri-list` item (support varies, as in Expo); hasString/hasImage/hasUrl → **W** `read()` item.types for data — and **S** clipboardExtras.types() when the point is *not prompting* to ask; change listeners → **W** `clipboardchange` event (added as MDN addition) | Android sensitive flag → **S** clipboardExtras.writeSensitive (added — no Web equivalent). PasteButton → **U**. HTML format via getType("text/html") |
| Network | getNetworkState/useNetworkState → **S** network.state/watch; getIpAddress → **S** network.ipAddress (added; local only — Expo's web path uses a third-party lookup, **—** by design); isAirplaneMode → **S** NetworkState.airplaneMode (added) | getMacAddress → **—**: modern OSes return a fixed dummy address; a typed lie helps nobody |
| Cellular | carrier/generation/ISO country → **S** NetworkState.cellular; MCC/MNC → added; allowsVoip → added | All fields optional: OSes withhold them, faithfully |
| Device | brand/manufacturer/model/design/deviceName/type/yearClass/os*/arch/memory → **S** app.device/platform (name/buildId added); getUptime → **S** app.uptimeSeconds (added); maxMemory → totalMemory | isRooted/sideload detection, platform-features flags → **P** (tamper signals are per-OS and adversarial) |
| Application | applicationId/name/versions → **S** app.info; install/update time → **S** AppInfo (added) | getAndroidId, IDFV, install referrer, store-environment probes → **P**, deliberately: stable per-platform identifiers stay out of the portable SDK (privacy) |
| Localization | getLocales/getCalendars → **W** Intl + **S** locale (temperature, 24h, first weekday are not Intl facts) | RTL layout forcing → **U**/config |
| Speech | speak/pause/resume/stop/isSpeaking/voices → **W** SpeechSynthesis + SpeechSynthesisUtterance | maxSpeechInputLength is UA-defined |
| Crypto | digest/digestString → **W** subtle.digest (encodings via Blob/TextEncoder); getRandomBytes/Values → **W** crypto.getRandomValues; randomUUID → **W** crypto.randomUUID; AES keygen/encrypt/decrypt → **W** AES-GCM | Their sealed-box AES helper is a convention over AES-GCM; apps own framing |
| BackgroundTask + TaskManager | define/register/unregister/unregisterAll/registered/isDefined → **S** tasks (cancelAll/defined added); getStatus → **S** availability; expiration listener → **S** TaskEvent "expiration" (added) | Trigger-for-testing is a dev tool, not an API |
| WebBrowser | openBrowser → **S** browser.open (added); openAuthSession → **S** auth.openSession; warmUp/coolDown/mayInit → **S** browser.warmUp; dismiss → **S** browser.dismiss; custom-tabs browser list → **S** supportingBrowsers | maybeCompleteAuthSession is RN-lifecycle plumbing → **—** |
| Linking | open/canOpen → **S** linking; initial URL + events → **S** app.initialURL/"url"; createURL/parse → **C** URL + config scheme; openSettings → **S** permissions.openSettings | sendIntent (Android) → **P**. clearInitialURL → **—** (immutable launch fact by design) |
| Battery | level/state/listeners → **W** BatteryManager (getBattery); low-power mode → **S** device.powerMode (added) | — |
| Sensors | accelerometer/gyro/magnetometer(uncal)/light/device-motion intervals → **W** Generic Sensors incl. `frequency` option; barometer → **S** device.barometer; pedometer → **S** device.pedometer | Availability probing per sensor → constructor + onerror in the standard |
| Print | printAsync(html/file), printToFile, selectPrinter → **S** printing (print, toPdf, printers added) | HTML-to-PDF needs an HTML engine; availability says so |
| AuthSession | request/discovery/exchange/refresh/revoke/userInfo → **S** auth.openSession + **C** fetch (token endpoints are HTTP by spec); makeRedirectUri → **B** (config scheme); PKCE → **C** Web Crypto; dismiss → AbortSignal | Provider-specific SDKs stay the providers' job, as Expo itself recommends |
| ImageManipulator | resize/rotate/flip/crop, save(format/quality/base64) → **S** images.process; base64 → **C** FileReader | — |

## Carried over from the module-design phase (not re-fetched this audit)

SecureStore, LocalAuthentication, Haptics, KeepAwake, ScreenOrientation,
Brightness, Sharing, DocumentPicker, SMS, MailComposer, StoreReview,
IntentLauncher, BlurView and other UI entries: audited at module level
in coverage.md and designed against their Expo contracts there; their
operation shapes are small enough that the module files themselves are
the audit. If a future Expo SDK adds operations, this file gets a new
row, not a rewrite.

## Verdict

For every Expo concept a developer can use today, there is a designed
home here: a Web standard without wrapping, an `@nts/sdk` gap module, a
composition of standards, or an explicitly recorded other-layer owner —
with maps/widgets and WebGPU out of scope by decision. **Interface-level
API parity with the Expo list is declared complete** as of this audit;
what remains is per-target implementation status, which is provider
work, not API design.
