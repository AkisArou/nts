#!/usr/bin/env python3
"""Extract the application-platform subset of TypeScript's lib.dom.d.ts
into ../lib.native-dom.d.ts, verbatim, plus an MDN-sourced additions
section for Web APIs lib.dom does not carry yet (BarcodeDetector,
Generic Sensors, Contact Picker, Battery).

Usage: python3 tools/extract-native-dom.py [path-to-typescript-lib-dir]
Default: $NTS_TS_LIB, else the pnpm typescript@7.0.2 native package in
the main checkout. The output is a *temporary* stand-in until nts owns a
real native lib generated from WebIDL (see DESIGN.md). Re-running with a
newer TypeScript is the intended update path; hand-edits belong in the
ADDITIONS / OVERRIDES constants below, never in the generated file.
"""
import os
import re
import sys

SEEDS = [
    # core platform
    "AbortController", "AbortSignal", "Event", "EventTarget", "CustomEvent",
    "ErrorEvent", "MessageEvent", "CloseEvent", "ProgressEvent", "DOMException",
    "TextEncoder", "TextDecoder", "TextEncoderStream", "TextDecoderStream",
    "URL", "URLSearchParams", "console", "Console", "queueMicrotask",
    "structuredClone", "atob", "btoa", "fetch", "setTimeout", "setInterval",
    "clearTimeout", "clearInterval", "DOMHighResTimeStamp", "Performance",
    "performance", "PerformanceEntry", "PerformanceMark", "PerformanceMeasure",
    "PerformanceObserver", "PerformanceResourceTiming", "PerformanceTiming",
    "PerformanceNavigation", "PerformanceNavigationTiming", "PerformanceServerTiming",
    "PerformanceObserverEntryList",
    # bytes / files / streams / fetch
    "Blob", "File", "FileList", "FileReader", "FormData", "Headers",
    "Request", "Response", "ReadableStream", "WritableStream",
    "TransformStream", "ByteLengthQueuingStrategy", "CountQueuingStrategy",
    "CompressionStream", "DecompressionStream",
    "FileSystemHandle", "FileSystemFileHandle", "FileSystemDirectoryHandle",
    "FileSystemWritableFileStream", "StorageManager", "Storage",
    "WebSocket", "EventSource", "MessageChannel", "MessagePort",
    "BroadcastChannel",
    # crypto
    "Crypto", "crypto", "SubtleCrypto", "CryptoKey", "CryptoKeyPair",
    # media
    "MediaDevices", "MediaStream", "MediaStreamTrack", "MediaRecorder",
    "ImageCapture", "MediaStreamConstraints", "MediaDeviceInfo",
    "ImageBitmap", "createImageBitmap", "VideoFrame", "AudioData",
    "DOMRectReadOnly", "DOMPointReadOnly", "DOMRect", "DOMPoint",
    # senses / device
    "Geolocation", "GeolocationPosition", "GeolocationCoordinates",
    "Permissions", "PermissionStatus", "WakeLock", "WakeLockSentinel",
    "DeviceMotionEvent", "DeviceOrientationEvent",
    # app services already in lib.dom
    "Notification", "PushManager", "PushSubscription",
    "Clipboard", "ClipboardItem", "ShareData",
    # credentials / webauthn (used by security passkeys)
    "CredentialsContainer", "Credential", "PublicKeyCredential",
    "AuthenticatorAssertionResponse", "AuthenticatorAttestationResponse",
    "AuthenticatorResponse",
    # locks / storage extras
    "LockManager", "Lock",
    # Step-3 adoptions (measured closures, docs/coverage.md):
    "ScreenOrientation", "SpeechSynthesis", "SpeechSynthesisUtterance",
    "speechSynthesis", "MediaSession", "MediaMetadata",
    "AudioContext", "OfflineAudioContext",
    "VideoDecoder", "VideoEncoder", "AudioDecoder", "AudioEncoder",
    "ImageDecoder", "IDBFactory", "IDBDatabase", "indexedDB",
    "RTCPeerConnection", "Gamepad", "Scheduler", "URLPattern",
    "FontFace", "FontFaceSet",
]

DENY_PREFIX = ("HTML", "SVG", "CSS")
DENY = {
    "Window", "WindowProxy", "Document", "Element", "Node", "NodeList", "ChildNode",
    "ParentNode", "DocumentFragment", "CharacterData", "Text", "Comment",
    "Attr", "NamedNodeMap", "DOMTokenList", "DOMParser",
    "MediaElementAudioSourceNode",
    "XMLSerializer", "XPathResult", "TreeWalker", "NodeIterator",
    "NodeFilter", "Range", "Selection", "MutationObserver",
    "MutationRecord", "IntersectionObserver", "IntersectionObserverEntry",
    "ResizeObserver", "ResizeObserverEntry", "ResizeObserverSize",
    "CanvasRenderingContext2D", "OffscreenCanvas", "OffscreenCanvasRenderingContext2D",
    "ImageBitmapRenderingContext", "WebGLRenderingContext",
    "WebGL2RenderingContext", "CanvasGradient", "CanvasPattern",
    "ImageData", "Path2D", "TextMetrics",
    "MediaQueryList", "MediaQueryListEvent", "Screen", "History",
    "Location", "BarProp", "External", "MimeTypeArray", "PluginArray",
    "Plugin", "MimeType", "Navigator", "WorkerGlobalScope",
    "DedicatedWorkerGlobalScope", "SharedWorkerGlobalScope",
    "ServiceWorkerGlobalScope", "WindowOrWorkerGlobalScope",
    "MediaElementAudioDestinationNode",
    "Animation", "AnimationEvent", "TransitionEvent", "KeyframeEffect",
    "AnimationTimeline", "DocumentTimeline", "ScrollTimeline",
    "VisualViewport", "Touch", "TouchEvent", "TouchList", "PointerEvent",
    "MouseEvent", "KeyboardEvent", "InputEvent", "CompositionEvent",
    "FocusEvent", "WheelEvent", "DragEvent", "ClipboardEvent",
    "BeforeUnloadEvent", "HashChangeEvent", "PageTransitionEvent",
    "PopStateEvent", "StorageEvent", "SubmitEvent", "ToggleEvent",
    "UIEvent", "GlobalEventHandlers", "GlobalEventHandlersEventMap",
    "WindowEventHandlers", "WindowEventHandlersEventMap", "WindowEventMap",
    "NavigateEvent", "NavigateEventInit", "Navigation", "NavigationHistoryEntry",
    "CustomElementRegistry", "CustomElementConstructor", "DataTransfer",
    "DataTransferItem", "DataTransferItemList", "DocumentOrShadowRoot",
    "ShadowRoot", "StyleSheetList", "StyleSheet", "XMLHttpRequest",
    "XMLHttpRequestEventTarget", "XMLHttpRequestUpload",
}

# Textual patches to otherwise-verbatim chunks: (needle, replacement).
# Each removes a DOM-tree-only member from an interface we do want.
PATCHES = [
    # FormData's form-element constructor has no form element natively.
    ("new(form?: HTMLFormElement, submitter?: HTMLElement | null): FormData;",
     "new(): FormData;"),
    # No HTMLMediaElement natively; media elements are an SDK/UI concept.
    ("createMediaElementSource(mediaElement: HTMLMediaElement): MediaElementAudioSourceNode;",
     ""),
]

# Trimmed replacements for aliases whose verbatim form needs the DOM tree.
OVERRIDES = {
    "ImageBitmapSource": "type ImageBitmapSource = Blob | ImageBitmap | VideoFrame;",
    "TexImageSource": "type TexImageSource = ImageBitmap | VideoFrame;",
    "CanvasImageSource": "type CanvasImageSource = ImageBitmap | VideoFrame;",
    "OffscreenCanvasImageSource": "type OffscreenCanvasImageSource = ImageBitmap | VideoFrame;",
    "Transferable": "type Transferable = ImageBitmap | MessagePort | ReadableStream | WritableStream | TransformStream | AudioData | VideoFrame;",
    "MessageEventSource": "type MessageEventSource = MessagePort;",
}

DECL = re.compile(r"^(?:interface|type|declare var|declare function|declare const|declare abstract class|declare class) ([A-Za-z_$][\w$]*)")
IDENT = re.compile(r"\b[A-Za-z_$][\w$]*\b")


def strip_line(line):
    line = re.sub(r'"(?:[^"\\]|\\.)*"', '""', line)
    line = re.sub(r"'(?:[^'\\]|\\.)*'", "''", line)
    line = re.sub(r"`(?:[^`\\]|\\.)*`", "``", line)
    return line.split("//")[0]


def parse(path, chunks, order):
    lines = open(path, encoding="utf-8").read().splitlines()
    i, n = 0, len(lines)
    pending = []
    while i < n:
        line = lines[i]
        if line.startswith("/**") or line.startswith("///") or line.startswith("/*"):
            pending = [line]
            i += 1
            while i < n and "*/" not in pending[-1] and not pending[-1].startswith("///"):
                pending.append(lines[i])
                i += 1
            continue
        m = DECL.match(line)
        if not m:
            pending = []
            i += 1
            continue
        name = m.group(1)
        body, depth, opened = [], 0, False
        while i < n:
            cur = lines[i]
            body.append(cur)
            i += 1
            if cur.lstrip().startswith("*") or cur.lstrip().startswith("/*"):
                continue
            s = strip_line(cur)
            depth += s.count("{") - s.count("}")
            if "{" in s:
                opened = True
            if opened and depth <= 0 and s.strip() in ("}", "};"):
                break
            if not opened and s.rstrip().endswith(";") and not s.rstrip().endswith(("|;", "&;")):
                break
        text = "\n".join(pending + body)
        pending = []
        chunks.setdefault(name, []).append(text)
        if name not in order:
            order[name] = len(order)


def denied(name):
    return name in DENY or name.startswith(DENY_PREFIX)


def main():
    libdir = sys.argv[1] if len(sys.argv) > 1 else os.environ.get(
        "NTS_TS_LIB", os.path.expanduser(
            "~/Projects/nts/node_modules/.pnpm/@typescript+typescript-linux-x64@7.0.2"
            "/node_modules/@typescript/typescript-linux-x64/lib"))
    chunks, order = {}, {}
    for f in ("lib.dom.d.ts", "lib.dom.iterable.d.ts", "lib.dom.asynciterable.d.ts"):
        parse(os.path.join(libdir, f), chunks, order)
    wanted, queue = set(), [s for s in SEEDS if s in chunks]
    missing = [s for s in SEEDS if s not in chunks]
    while queue:
        name = queue.pop()
        if name in wanted or denied(name):
            continue
        wanted.add(name)
        for text in chunks.get(name, []):
            code = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
            code = re.sub(r"//.*", "", code)
            for ref in IDENT.findall(code):
                if not (ref[:1].isupper() or ref in SEEDS):
                    continue
                if ref in chunks and ref not in wanted and not denied(ref):
                    queue.append(ref)
    out = [HEADER]
    for name in sorted(wanted, key=lambda x: order[x]):
        if name in OVERRIDES:
            out.append(OVERRIDES[name])
            continue
        for text in chunks[name]:
            for needle, repl in PATCHES:
                text = text.replace(needle, repl)
            out.append(text)
    out.append(ADDITIONS)
    out.append(ADDITIONS2)
    out_path = os.path.join(os.path.dirname(__file__), "..", "lib.native-dom.d.ts")
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write("\n\n".join(out) + "\n")
    total = sum(len(c.splitlines()) for c in out)
    print(f"seeds missing from lib: {missing}")
    print(f"wrote {out_path}: {len(wanted)} declarations, {total} lines")


HEADER = """/**
 * lib.native-dom.d.ts — TEMPORARY, generated. Do not hand-edit.
 *
 * The application-platform subset of TypeScript 7.0.2's lib.dom.d.ts
 * (plus its iterable/asynciterable companions), copied verbatim by
 * tools/extract-native-dom.py, for nts application targets that have no
 * browser document: native mobile/desktop and the Blink host's app
 * realm. Web platform shape, no Window/Document/Element tree.
 *
 * TypeScript's lib files are Apache-2.0 (Copyright Microsoft); see
 * https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt
 *
 * Two kinds of deviation, both produced by the extractor and recorded
 * there: OVERRIDES (aliases trimmed of DOM-tree members) and the
 * MDN-sourced additions at the end (APIs lib.dom does not carry yet).
 * This file is a stand-in until nts generates a native lib from WebIDL;
 * membership here is a *typing* convenience, not a conformance claim —
 * docs/compatibility tracks what each target actually implements.
 */"""

ADDITIONS = """// ===========================================================================
// MDN-SOURCED ADDITIONS — Web APIs lib.dom.d.ts (TS 7.0.2) does not carry.
// Hand-written from the MDN references and the underlying specifications,
// in lib.dom style. Verified missing from lib.dom by probe (2026-10-16):
// BarcodeDetector, Generic Sensors, ContactsManager, BatteryManager.
// ===========================================================================

// ---- Barcode Detection (Shape Detection API) -------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector
// Spec: https://wicg.github.io/shape-detection-api/#barcode-detection-api

type BarcodeFormat =
  | "aztec" | "code_128" | "code_39" | "code_93" | "codabar" | "data_matrix"
  | "ean_13" | "ean_8" | "itf" | "pdf417" | "qr_code" | "upc_a" | "upc_e"
  | "unknown";

interface BarcodeDetectorOptions {
  formats?: BarcodeFormat[];
}

interface DetectedBarcode {
  readonly boundingBox: DOMRectReadOnly;
  readonly rawValue: string;
  readonly format: BarcodeFormat;
  readonly cornerPoints: readonly DOMPointReadOnly[];
}

interface BarcodeDetector {
  detect(image: ImageBitmapSource): Promise<DetectedBarcode[]>;
}

declare var BarcodeDetector: {
  prototype: BarcodeDetector;
  new (options?: BarcodeDetectorOptions): BarcodeDetector;
  getSupportedFormats(): Promise<BarcodeFormat[]>;
};

// ---- Generic Sensor API ------------------------------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/Sensor
// https://developer.mozilla.org/en-US/docs/Web/API/Accelerometer (etc.)
// Spec: https://www.w3.org/TR/generic-sensor/ and per-sensor specs

type SensorLocalCoordinateSystem = "device" | "screen";

interface SensorOptions {
  frequency?: number;
  referenceFrame?: SensorLocalCoordinateSystem;
}

interface SensorErrorEventInit extends EventInit {
  error: DOMException;
}

interface SensorErrorEvent extends Event {
  readonly error: DOMException;
}

declare var SensorErrorEvent: {
  prototype: SensorErrorEvent;
  new (type: string, init: SensorErrorEventInit): SensorErrorEvent;
};

interface Sensor extends EventTarget {
  readonly activated: boolean;
  readonly hasReading: boolean;
  readonly timestamp: DOMHighResTimeStamp | null;
  onactivate: ((this: Sensor, ev: Event) => void) | null;
  onerror: ((this: Sensor, ev: SensorErrorEvent) => void) | null;
  onreading: ((this: Sensor, ev: Event) => void) | null;
  start(): void;
  stop(): void;
}

declare var Sensor: { prototype: Sensor; new (): Sensor };

interface MotionSensor extends Sensor {
  readonly x: number | null;
  readonly y: number | null;
  readonly z: number | null;
}

interface Accelerometer extends MotionSensor {}
interface LinearAccelerationSensor extends MotionSensor {}
interface GravitySensor extends MotionSensor {}
interface Gyroscope extends MotionSensor {}
interface Magnetometer extends MotionSensor {}
interface UncalibratedMagnetometer extends MotionSensor {
  readonly xBias: number | null;
  readonly yBias: number | null;
  readonly zBias: number | null;
}

declare var Accelerometer: { prototype: Accelerometer; new (options?: SensorOptions): Accelerometer };
declare var LinearAccelerationSensor: { prototype: LinearAccelerationSensor; new (options?: SensorOptions): LinearAccelerationSensor };
declare var GravitySensor: { prototype: GravitySensor; new (options?: SensorOptions): GravitySensor };
declare var Gyroscope: { prototype: Gyroscope; new (options?: SensorOptions): Gyroscope };
declare var Magnetometer: { prototype: Magnetometer; new (options?: SensorOptions): Magnetometer };
declare var UncalibratedMagnetometer: { prototype: UncalibratedMagnetometer; new (options?: SensorOptions): UncalibratedMagnetometer };

interface OrientationSensor extends Sensor {
  readonly quaternion: ReadonlyArray<number> | null;
  populateMatrix(matrix: Float32Array | Float64Array): void;
}

interface AbsoluteOrientationSensor extends OrientationSensor {}
interface RelativeOrientationSensor extends OrientationSensor {}

declare var AbsoluteOrientationSensor: { prototype: AbsoluteOrientationSensor; new (options?: SensorOptions): AbsoluteOrientationSensor };
declare var RelativeOrientationSensor: { prototype: RelativeOrientationSensor; new (options?: SensorOptions): RelativeOrientationSensor };

interface AmbientLightSensor extends Sensor {
  readonly illuminance: number | null;
}

declare var AmbientLightSensor: { prototype: AmbientLightSensor; new (options?: SensorOptions): AmbientLightSensor };

// ---- Contact Picker API ------------------------------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/ContactsManager/select
// Spec: https://wicg.github.io/contact-api/spec/

type ContactProperty = "address" | "email" | "icon" | "name" | "tel";

interface ContactsSelectOptions {
  multiple?: boolean;
}

interface ContactAddress {
  readonly addressLine: readonly string[];
  readonly city: string;
  readonly country: string;
  readonly dependentLocality: string;
  readonly organization: string;
  readonly phone: string;
  readonly postalCode: string;
  readonly recipient: string;
  readonly region: string;
  readonly sortingCode: string;
}

interface ContactInfo {
  readonly address?: readonly ContactAddress[];
  readonly email?: readonly string[];
  readonly icon?: readonly Blob[];
  readonly name?: readonly string[];
  readonly tel?: readonly string[];
}

interface ContactsManager {
  getProperties(): Promise<ContactProperty[]>;
  select(properties: ContactProperty[], options?: ContactsSelectOptions): Promise<ContactInfo[]>;
}

// ---- Battery Status API --------------------------------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/BatteryManager
// (Removed from some browsers for privacy; meaningful on native targets.)

interface BatteryManager extends EventTarget {
  readonly charging: boolean;
  /** Seconds until full; Infinity when not charging/unknown. */
  readonly chargingTime: number;
  /** Seconds until empty; Infinity when charging/unknown. */
  readonly dischargingTime: number;
  /** 0..1 */
  readonly level: number;
  onchargingchange: ((this: BatteryManager, ev: Event) => void) | null;
  onchargingtimechange: ((this: BatteryManager, ev: Event) => void) | null;
  ondischargingtimechange: ((this: BatteryManager, ev: Event) => void) | null;
  onlevelchange: ((this: BatteryManager, ev: Event) => void) | null;
}

// ---- Network Information API ---------------------------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/NetworkInformation
// Spec: https://wicg.github.io/netinfo/

type ConnectionType = "bluetooth" | "cellular" | "ethernet" | "mixed" | "none" | "other" | "unknown" | "wifi" | "wimax";
type EffectiveConnectionType = "2g" | "3g" | "4g" | "slow-2g";

interface NetworkInformation extends EventTarget {
  readonly type?: ConnectionType;
  readonly effectiveType?: EffectiveConnectionType;
  /** Estimated downlink speed in megabits per second. */
  readonly downlink?: number;
  readonly downlinkMax?: number;
  /** Estimated round-trip time in milliseconds. */
  readonly rtt?: number;
  readonly saveData?: boolean;
  onchange: ((this: NetworkInformation, ev: Event) => void) | null;
}

// ---- Device Posture API ----------------------------------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/DevicePosture
// Spec: https://www.w3.org/TR/device-posture/

type DevicePostureType = "continuous" | "folded";

interface DevicePosture extends EventTarget {
  readonly type: DevicePostureType;
  onchange: ((this: DevicePosture, ev: Event) => void) | null;
}

declare var DevicePosture: { prototype: DevicePosture; new (): DevicePosture };

// ---- Screen (trimmed) ------------------------------------------------------------
// lib.dom's Screen is a seed we exclude, but ScreenOrientation (adopted
// verbatim) is reached as screen.orientation. This trimmed interface is
// the spec's Screen minus window-management members (ScreenDetails is a
// later, desktop-ledger decision).

interface Screen {
  readonly orientation: ScreenOrientation;
  readonly width: number;
  readonly height: number;
  readonly availWidth: number;
  readonly availHeight: number;
  readonly colorDepth: number;
  readonly pixelDepth: number;
}

declare var Screen: { prototype: Screen; new (): Screen };
declare var screen: Screen;

// ---- Navigator (trimmed) -------------------------------------------------------
// lib.dom's Navigator merges dozens of partial interfaces bound to the
// browser document (plugins, presentation, XR, ...). A native app realm
// has a navigator with exactly the application-platform members. Member
// semantics are the standards'; this interface only *selects* them.

type VibratePattern = number | number[];

interface Navigator {
  readonly mediaDevices: MediaDevices;
  readonly geolocation: Geolocation;
  readonly permissions: Permissions;
  readonly clipboard: Clipboard;
  readonly credentials: CredentialsContainer;
  readonly storage: StorageManager;
  readonly locks: LockManager;
  readonly wakeLock: WakeLock;
  readonly contacts: ContactsManager;
  readonly mediaSession: MediaSession;
  readonly connection?: NetworkInformation;
  readonly devicePosture?: DevicePosture;
  getGamepads(): (Gamepad | null)[];
  readonly userAgent: string;
  readonly language: string;
  readonly languages: readonly string[];
  readonly onLine: boolean;
  readonly hardwareConcurrency: number;
  readonly maxTouchPoints: number;
  share(data?: ShareData): Promise<void>;
  canShare(data?: ShareData): boolean;
  getBattery(): Promise<BatteryManager>;
  vibrate(pattern: VibratePattern): boolean;
  setAppBadge(contents?: number): Promise<void>;
  clearAppBadge(): Promise<void>;
}

declare var navigator: Navigator;
declare var Navigator: { prototype: Navigator; new (): Navigator };"""

ADDITIONS2 = """// ===========================================================================
// MDN-SOURCED ADDITIONS, ROUND 2 — SpeechRecognition and the hardware-
// access family (Web Bluetooth, Web NFC, WebUSB, Web Serial, WebHID),
// plus FileSystemObserver, Compute Pressure, Idle Detection, EyeDropper,
// Keyboard (layout/lock) and Launch Handler. All verified absent from
// lib.dom 7.0.2 by probe (2026-10-16). Shapes follow the MDN references
// and the underlying specs; device access goes through the platform's
// chooser/permission UI exactly as specified — no relaxation natively.
// ===========================================================================

// ---- Web Speech: recognition (synthesis is in lib.dom proper) -------------
// https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative | null;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult | null;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEventInit extends EventInit {
  resultIndex?: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

declare var SpeechRecognitionEvent: {
  prototype: SpeechRecognitionEvent;
  new (type: string, init: SpeechRecognitionEventInit): SpeechRecognitionEvent;
};

type SpeechRecognitionErrorCode =
  | "no-speech" | "aborted" | "audio-capture" | "network" | "not-allowed"
  | "service-not-allowed" | "language-not-supported" | "phrases-not-supported";

interface SpeechRecognitionErrorEventInit extends EventInit {
  error: SpeechRecognitionErrorCode;
  message?: string;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: SpeechRecognitionErrorCode;
  readonly message: string;
}

declare var SpeechRecognitionErrorEvent: {
  prototype: SpeechRecognitionErrorEvent;
  new (type: string, init: SpeechRecognitionErrorEventInit): SpeechRecognitionErrorEvent;
};

interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  /** Prefer on-device recognition where the platform supports it. */
  processLocally: boolean;
  onaudiostart: ((this: SpeechRecognition, ev: Event) => void) | null;
  onaudioend: ((this: SpeechRecognition, ev: Event) => void) | null;
  onend: ((this: SpeechRecognition, ev: Event) => void) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null;
  onnomatch: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
  onsoundstart: ((this: SpeechRecognition, ev: Event) => void) | null;
  onsoundend: ((this: SpeechRecognition, ev: Event) => void) | null;
  onspeechstart: ((this: SpeechRecognition, ev: Event) => void) | null;
  onspeechend: ((this: SpeechRecognition, ev: Event) => void) | null;
  onstart: ((this: SpeechRecognition, ev: Event) => void) | null;
  abort(): void;
  start(): void;
  stop(): void;
}

declare var SpeechRecognition: {
  prototype: SpeechRecognition;
  new (): SpeechRecognition;
  available(options: { langs: string[]; processLocally?: boolean }): Promise<"available" | "downloadable" | "downloading" | "unavailable">;
  install(options: { langs: string[]; processLocally?: boolean }): Promise<boolean>;
};

// ---- Web Bluetooth ---------------------------------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/Bluetooth
// Spec: https://webbluetoothcg.github.io/web-bluetooth/

type BluetoothServiceUUID = string | number;
type BluetoothCharacteristicUUID = string | number;
type BluetoothDescriptorUUID = string | number;

interface BluetoothRequestDeviceFilter {
  services?: BluetoothServiceUUID[];
  optionalServices?: BluetoothServiceUUID[];
  optionalManufacturerData?: number[];
  name?: string;
  namePrefix?: string;
  manufacturerData?: { companyIdentifier: number; dataPrefix?: Uint8Array; mask?: Uint8Array }[];
  serviceData?: { service: BluetoothServiceUUID; dataPrefix?: Uint8Array; mask?: Uint8Array }[];
}

interface RequestDeviceOptions {
  filters?: BluetoothRequestDeviceFilter[];
  exclusionFilters?: BluetoothRequestDeviceFilter[];
  optionalServices?: BluetoothServiceUUID[];
  optionalManufacturerData?: number[];
  acceptAllDevices?: boolean;
}

interface BluetoothCharacteristicProperties {
  readonly broadcast: boolean;
  readonly read: boolean;
  readonly writeWithoutResponse: boolean;
  readonly write: boolean;
  readonly notify: boolean;
  readonly indicate: boolean;
  readonly authenticatedSignedWrites: boolean;
  readonly reliableWrite: boolean;
  readonly writableAuxiliaries: boolean;
}

interface BluetoothRemoteGATTDescriptor extends EventTarget {
  readonly characteristic: BluetoothRemoteGATTCharacteristic;
  readonly uuid: string;
  readonly value?: DataView;
  readValue(): Promise<DataView>;
  writeValue(value: BufferSource): Promise<void>;
}

interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  readonly service: BluetoothRemoteGATTService;
  readonly uuid: string;
  readonly properties: BluetoothCharacteristicProperties;
  readonly value?: DataView;
  oncharacteristicvaluechanged: ((this: BluetoothRemoteGATTCharacteristic, ev: Event) => void) | null;
  getDescriptor(descriptor: BluetoothDescriptorUUID): Promise<BluetoothRemoteGATTDescriptor>;
  getDescriptors(descriptor?: BluetoothDescriptorUUID): Promise<BluetoothRemoteGATTDescriptor[]>;
  readValue(): Promise<DataView>;
  writeValueWithResponse(value: BufferSource): Promise<void>;
  writeValueWithoutResponse(value: BufferSource): Promise<void>;
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface BluetoothRemoteGATTService extends EventTarget {
  readonly device: BluetoothDevice;
  readonly uuid: string;
  readonly isPrimary: boolean;
  getCharacteristic(characteristic: BluetoothCharacteristicUUID): Promise<BluetoothRemoteGATTCharacteristic>;
  getCharacteristics(characteristic?: BluetoothCharacteristicUUID): Promise<BluetoothRemoteGATTCharacteristic[]>;
  getIncludedService(service: BluetoothServiceUUID): Promise<BluetoothRemoteGATTService>;
  getIncludedServices(service?: BluetoothServiceUUID): Promise<BluetoothRemoteGATTService[]>;
}

interface BluetoothRemoteGATTServer {
  readonly device: BluetoothDevice;
  readonly connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(service: BluetoothServiceUUID): Promise<BluetoothRemoteGATTService>;
  getPrimaryServices(service?: BluetoothServiceUUID): Promise<BluetoothRemoteGATTService[]>;
}

interface BluetoothDevice extends EventTarget {
  readonly id: string;
  readonly name?: string;
  readonly gatt?: BluetoothRemoteGATTServer;
  ongattserverdisconnected: ((this: BluetoothDevice, ev: Event) => void) | null;
  forget(): Promise<void>;
}

declare var BluetoothDevice: { prototype: BluetoothDevice; new (): BluetoothDevice };

interface Bluetooth extends EventTarget {
  getAvailability(): Promise<boolean>;
  getDevices(): Promise<BluetoothDevice[]>;
  requestDevice(options?: RequestDeviceOptions): Promise<BluetoothDevice>;
  onavailabilitychanged: ((this: Bluetooth, ev: Event) => void) | null;
}

// ---- Web NFC ---------------------------------------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/NDEFReader
// Spec: https://w3c.github.io/web-nfc/

type NDEFRecordType = string;

interface NDEFRecordInit {
  recordType: NDEFRecordType;
  mediaType?: string;
  id?: string;
  data?: BufferSource | string | NDEFMessageInit;
  encoding?: string;
  lang?: string;
}

interface NDEFMessageInit {
  records: NDEFRecordInit[];
}

interface NDEFRecord {
  readonly recordType: NDEFRecordType;
  readonly mediaType?: string;
  readonly id?: string;
  readonly data?: DataView;
  readonly encoding?: string;
  readonly lang?: string;
  toRecords(): NDEFRecord[] | undefined;
}

declare var NDEFRecord: { prototype: NDEFRecord; new (init: NDEFRecordInit): NDEFRecord };

interface NDEFMessage {
  readonly records: readonly NDEFRecord[];
}

declare var NDEFMessage: { prototype: NDEFMessage; new (init: NDEFMessageInit): NDEFMessage };

interface NDEFReadingEventInit extends EventInit {
  serialNumber?: string;
  message: NDEFMessageInit;
}

interface NDEFReadingEvent extends Event {
  readonly serialNumber: string;
  readonly message: NDEFMessage;
}

declare var NDEFReadingEvent: {
  prototype: NDEFReadingEvent;
  new (type: string, init: NDEFReadingEventInit): NDEFReadingEvent;
};

interface NDEFReader extends EventTarget {
  onreading: ((this: NDEFReader, ev: NDEFReadingEvent) => void) | null;
  onreadingerror: ((this: NDEFReader, ev: Event) => void) | null;
  scan(options?: { signal?: AbortSignal }): Promise<void>;
  write(message: NDEFMessageInit | string, options?: { overwrite?: boolean; signal?: AbortSignal }): Promise<void>;
  makeReadOnly(options?: { signal?: AbortSignal }): Promise<void>;
}

declare var NDEFReader: { prototype: NDEFReader; new (): NDEFReader };

// ---- WebUSB ----------------------------------------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/USB
// Spec: https://wicg.github.io/webusb/

interface USBDeviceFilter {
  vendorId?: number;
  productId?: number;
  classCode?: number;
  subclassCode?: number;
  protocolCode?: number;
  serialNumber?: string;
}

interface USBControlTransferParameters {
  requestType: "standard" | "class" | "vendor";
  recipient: "device" | "interface" | "endpoint" | "other";
  request: number;
  value: number;
  index: number;
}

interface USBInTransferResult {
  readonly data?: DataView;
  readonly status: "ok" | "stall" | "babble";
}

interface USBOutTransferResult {
  readonly bytesWritten: number;
  readonly status: "ok" | "stall";
}

interface USBIsochronousInTransferPacket {
  readonly data?: DataView;
  readonly status: "ok" | "stall" | "babble";
}

interface USBIsochronousInTransferResult {
  readonly data?: DataView;
  readonly packets: readonly USBIsochronousInTransferPacket[];
}

interface USBIsochronousOutTransferPacket {
  readonly bytesWritten: number;
  readonly status: "ok" | "stall";
}

interface USBIsochronousOutTransferResult {
  readonly packets: readonly USBIsochronousOutTransferPacket[];
}

interface USBEndpoint {
  readonly endpointNumber: number;
  readonly direction: "in" | "out";
  readonly type: "bulk" | "interrupt" | "isochronous";
  readonly packetSize: number;
}

declare var USBEndpoint: { prototype: USBEndpoint; new (): USBEndpoint };

interface USBAlternateInterface {
  readonly alternateSetting: number;
  readonly interfaceClass: number;
  readonly interfaceSubclass: number;
  readonly interfaceProtocol: number;
  readonly interfaceName?: string;
  readonly endpoints: readonly USBEndpoint[];
}

declare var USBAlternateInterface: { prototype: USBAlternateInterface; new (): USBAlternateInterface };

interface USBInterface {
  readonly interfaceNumber: number;
  readonly alternate: USBAlternateInterface;
  readonly alternates: readonly USBAlternateInterface[];
  readonly claimed: boolean;
}

declare var USBInterface: { prototype: USBInterface; new (): USBInterface };

interface USBConfiguration {
  readonly configurationValue: number;
  readonly configurationName?: string;
  readonly interfaces: readonly USBInterface[];
}

declare var USBConfiguration: { prototype: USBConfiguration; new (): USBConfiguration };

interface USBDevice extends EventTarget {
  readonly usbVersionMajor: number;
  readonly usbVersionMinor: number;
  readonly usbVersionSubminor: number;
  readonly deviceClass: number;
  readonly deviceSubclass: number;
  readonly deviceProtocol: number;
  readonly deviceVersionMajor: number;
  readonly deviceVersionMinor: number;
  readonly deviceVersionSubminor: number;
  readonly vendorId: number;
  readonly productId: number;
  readonly manufacturerName?: string;
  readonly productName?: string;
  readonly serialNumber?: string;
  readonly configuration?: USBConfiguration;
  readonly configurations: readonly USBConfiguration[];
  readonly opened: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
  forget(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface(interfaceNumber: number): Promise<void>;
  selectAlternateInterface(interfaceNumber: number, alternateSetting: number): Promise<void>;
  controlTransferIn(setup: USBControlTransferParameters, length: number): Promise<USBInTransferResult>;
  controlTransferOut(setup: USBControlTransferParameters, data?: BufferSource): Promise<USBOutTransferResult>;
  clearHalt(direction: "in" | "out", endpointNumber: number): Promise<void>;
  transferIn(endpointNumber: number, length: number): Promise<USBInTransferResult>;
  transferOut(endpointNumber: number, data: BufferSource): Promise<USBOutTransferResult>;
  isochronousTransferIn(endpointNumber: number, packetLengths: number[]): Promise<USBIsochronousInTransferResult>;
  isochronousTransferOut(endpointNumber: number, data: BufferSource, packetLengths: number[]): Promise<USBIsochronousOutTransferResult>;
  reset(): Promise<void>;
}

declare var USBDevice: { prototype: USBDevice; new (): USBDevice };

interface USBConnectionEventInit extends EventInit {
  device: USBDevice;
}

interface USBConnectionEvent extends Event {
  readonly device: USBDevice;
}

declare var USBConnectionEvent: {
  prototype: USBConnectionEvent;
  new (type: string, init: USBConnectionEventInit): USBConnectionEvent;
};

interface USB extends EventTarget {
  onconnect: ((this: USB, ev: USBConnectionEvent) => void) | null;
  ondisconnect: ((this: USB, ev: USBConnectionEvent) => void) | null;
  getDevices(): Promise<USBDevice[]>;
  requestDevice(options: { filters: USBDeviceFilter[]; exclusionFilters?: USBDeviceFilter[] }): Promise<USBDevice>;
}

// ---- Web Serial ---------------------------------------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/Serial
// Spec: https://wicg.github.io/serial/

interface SerialOptions {
  baudRate: number;
  dataBits?: 7 | 8;
  stopBits?: 1 | 2;
  parity?: "none" | "even" | "odd";
  bufferSize?: number;
  flowControl?: "none" | "hardware";
}

interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
  bluetoothServiceClassId?: string | number;
}

interface SerialPort extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  onconnect: ((this: SerialPort, ev: Event) => void) | null;
  ondisconnect: ((this: SerialPort, ev: Event) => void) | null;
  open(options: SerialOptions): Promise<void>;
  close(): Promise<void>;
  forget(): Promise<void>;
  getInfo(): SerialPortInfo;
  setSignals(signals: {
    dataTerminalReady?: boolean;
    requestToSend?: boolean;
    break?: boolean;
  }): Promise<void>;
  getSignals(): Promise<{
    clearToSend: boolean;
    dataCarrierDetect: boolean;
    dataSetReady: boolean;
    ringIndicator: boolean;
  }>;
}

declare var SerialPort: { prototype: SerialPort; new (): SerialPort };

interface Serial extends EventTarget {
  onconnect: ((this: Serial, ev: Event) => void) | null;
  ondisconnect: ((this: Serial, ev: Event) => void) | null;
  getPorts(): Promise<SerialPort[]>;
  requestPort(options?: { filters?: SerialPortFilter[]; allowedBluetoothServiceClassIds?: (string | number)[] }): Promise<SerialPort>;
}

interface SerialPortFilter {
  usbVendorId?: number;
  usbProductId?: number;
  bluetoothServiceClassId?: string | number;
}

// ---- WebHID -------------------------------------------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/HID
// Spec: https://wicg.github.io/webhid/

interface HIDDeviceFilter {
  vendorId?: number;
  productId?: number;
  usagePage?: number;
  usage?: number;
}

interface HIDCollectionInfo {
  usagePage: number;
  usage: number;
  type: number;
  children: HIDCollectionInfo[];
  inputReports: HIDReportInfo[];
  outputReports: HIDReportInfo[];
  featureReports: HIDReportInfo[];
}

interface HIDReportItem {
  isAbsolute?: boolean;
  isArray?: boolean;
  isBufferedBytes?: boolean;
  isConstant?: boolean;
  isLinear?: boolean;
  isRange?: boolean;
  isVolatile?: boolean;
  hasNull?: boolean;
  hasPreferredState?: boolean;
  isWrapped?: boolean;
  logicalMinimum: number;
  logicalMaximum: number;
  physicalMinimum: number;
  physicalMaximum: number;
  unitExponent: number;
  unitSystem: string;
  unitFactorLengthExponent: number;
  unitFactorMassExponent: number;
  unitFactorTimeExponent: number;
  unitFactorTemperatureExponent: number;
  unitFactorCurrentExponent: number;
  unitFactorLuminousIntensityExponent: number;
  usages: number[];
  usageMinimum: number;
  usageMaximum: number;
  reportSize: number;
  reportCount: number;
  strings: string[];
}

interface HIDReportInfo {
  reportId: number;
  items: HIDReportItem[];
}

interface HIDInputReportEventInit extends EventInit {
  device: HIDDevice;
  reportId: number;
  data: DataView;
}

interface HIDInputReportEvent extends Event {
  readonly device: HIDDevice;
  readonly reportId: number;
  readonly data: DataView;
}

declare var HIDInputReportEvent: {
  prototype: HIDInputReportEvent;
  new (type: string, init: HIDInputReportEventInit): HIDInputReportEvent;
};

interface HIDDevice extends EventTarget {
  readonly opened: boolean;
  readonly vendorId: number;
  readonly productId: number;
  readonly productName: string;
  readonly collections: readonly HIDCollectionInfo[];
  oninputreport: ((this: HIDDevice, ev: HIDInputReportEvent) => void) | null;
  open(): Promise<void>;
  close(): Promise<void>;
  forget(): Promise<void>;
  sendReport(reportId: number, data: BufferSource): Promise<void>;
  sendFeatureReport(reportId: number, data: BufferSource): Promise<void>;
  receiveFeatureReport(reportId: number): Promise<DataView>;
}

declare var HIDDevice: { prototype: HIDDevice; new (): HIDDevice };

interface HIDConnectionEventInit extends EventInit {
  device: HIDDevice;
}

interface HIDConnectionEvent extends Event {
  readonly device: HIDDevice;
}

declare var HIDConnectionEvent: {
  prototype: HIDConnectionEvent;
  new (type: string, init: HIDConnectionEventInit): HIDConnectionEvent;
};

interface HID extends EventTarget {
  onconnect: ((this: HID, ev: HIDConnectionEvent) => void) | null;
  ondisconnect: ((this: HID, ev: HIDConnectionEvent) => void) | null;
  getDevices(): Promise<HIDDevice[]>;
  requestDevice(options: { filters: HIDDeviceFilter[]; exclusionFilters?: HIDDeviceFilter[] }): Promise<HIDDevice[]>;
}

// ---- FileSystemObserver ---------------------------------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/FileSystemObserver

type FileSystemChangeType = "appeared" | "disappeared" | "modified" | "moved" | "unknown" | "errored";

interface FileSystemChangeRecord {
  readonly root: FileSystemHandle;
  readonly changedHandle: FileSystemHandle | null;
  readonly relativePathComponents: readonly string[];
  readonly type: FileSystemChangeType;
  readonly relativePathMovedFrom?: readonly string[];
}

type FileSystemObserverCallback = (records: FileSystemChangeRecord[], observer: FileSystemObserver) => void;

interface FileSystemObserver {
  observe(handle: FileSystemHandle, options?: { recursive?: boolean }): Promise<void>;
  unobserve(handle: FileSystemHandle): void;
  disconnect(): void;
}

declare var FileSystemObserver: {
  prototype: FileSystemObserver;
  new (callback: FileSystemObserverCallback): FileSystemObserver;
};

// ---- Compute Pressure --------------------------------------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/PressureObserver

type PressureSource = "thermals" | "cpu";
type PressureState = "nominal" | "fair" | "serious" | "critical";

interface PressureRecord {
  readonly source: PressureSource;
  readonly state: PressureState;
  readonly time: DOMHighResTimeStamp;
  toJSON(): unknown;
}

type PressureUpdateCallback = (changes: PressureRecord[], observer: PressureObserver) => void;

interface PressureObserver {
  observe(source: PressureSource, options?: { sampleInterval?: number }): Promise<void>;
  unobserve(source: PressureSource): void;
  disconnect(): void;
  takeRecords(): PressureRecord[];
}

declare var PressureObserver: {
  prototype: PressureObserver;
  new (callback: PressureUpdateCallback, options?: { sampleInterval?: number }): PressureObserver;
  readonly knownSources: readonly PressureSource[];
};

// ---- Idle Detection -------------------------------------------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/IdleDetector

type UserIdleState = "active" | "idle";
type ScreenIdleState = "locked" | "unlocked";

interface IdleDetector extends EventTarget {
  readonly userState: UserIdleState | null;
  readonly screenState: ScreenIdleState | null;
  onchange: ((this: IdleDetector, ev: Event) => void) | null;
  start(options?: { threshold?: number; signal?: AbortSignal }): Promise<void>;
}

declare var IdleDetector: {
  prototype: IdleDetector;
  new (): IdleDetector;
  requestPermission(): Promise<PermissionState>;
};

// ---- EyeDropper -------------------------------------------------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/EyeDropper

interface EyeDropperOpenOptions {
  signal?: AbortSignal;
}

interface ColorSelectionResult {
  readonly sRGBHex: string;
}

interface EyeDropper {
  open(options?: EyeDropperOpenOptions): Promise<ColorSelectionResult>;
}

declare var EyeDropper: { prototype: EyeDropper; new (): EyeDropper };

// ---- Keyboard (layout map + lock) ----------------------------------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/Keyboard

interface KeyboardLayoutMap {
  readonly size: number;
  entries(): IterableIterator<[string, string]>;
  keys(): IterableIterator<string>;
  values(): IterableIterator<string>;
  forEach(callback: (value: string, key: string, map: KeyboardLayoutMap) => void): void;
  get(key: string): string | undefined;
  has(key: string): boolean;
  [Symbol.iterator](): IterableIterator<[string, string]>;
}

interface Keyboard extends EventTarget {
  getLayoutMap(): Promise<KeyboardLayoutMap>;
  lock(keyCodes?: string[]): Promise<void>;
  unlock(): void;
  onlayoutchange: ((this: Keyboard, ev: Event) => void) | null;
}

// ---- Launch Handler ---------------------------------------------------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/LaunchQueue

interface LaunchParams {
  readonly files: readonly FileSystemFileHandle[];
  readonly targetURL?: string;
}

type LaunchConsumer = (params: LaunchParams) => void;

interface LaunchQueue {
  setConsumer(consumer: LaunchConsumer): void;
}

declare var launchQueue: LaunchQueue;

// ---- Clipboard change event ------------------------------------------------------
// https://developer.mozilla.org/en-US/docs/Web/API/ClipboardChangeEvent

interface ClipboardChangeEventInit extends EventInit {
  types?: string[];
  changeId?: bigint;
}

interface ClipboardChangeEvent extends Event {
  readonly types: readonly string[];
  readonly changeId: bigint;
}

declare var ClipboardChangeEvent: {
  prototype: ClipboardChangeEvent;
  new (type: string, init?: ClipboardChangeEventInit): ClipboardChangeEvent;
};

interface Clipboard {
  addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean): void;
  removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean): void;
  addEventListener(
    type: "clipboardchange",
    listener: (this: Clipboard, ev: ClipboardChangeEvent) => void,
    options?: AddEventListenerOptions | boolean,
  ): void;
  removeEventListener(
    type: "clipboardchange",
    listener: (this: Clipboard, ev: ClipboardChangeEvent) => void,
    options?: EventListenerOptions | boolean,
  ): void;
}

// ---- Navigator additions (interface merging with the trimmed Navigator above) ------------

interface Navigator {
  readonly bluetooth: Bluetooth;
  readonly usb: USB;
  readonly serial: Serial;
  readonly hid: HID;
  readonly keyboard: Keyboard;
}
"""

if __name__ == "__main__":
    main()


