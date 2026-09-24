// A Win32 window whose window procedure is TypeScript, and TypeScript's own
// event loop turning inside the Win32 one.
//
// The window is created hidden. `GetMessageW` then owns the thread from inside
// module evaluation, as it does in any Win32 program, and the window is closed
// by an `await` on a `setTimeout` promise. That runs only if libuv turns while
// the message loop does, which is `nts_win_host`'s job.
//
// **The control is built in.** A Win32 timer ticks every 10 ms, and at the
// 200th tick (about two seconds) the window is closed by that failsafe
// instead. A program whose libuv never turns prints `by=failsafe`, not a
// hang.
import { report } from "c:report";
import { local } from "c:memory";
import { malloc } from "c:stdlib";
import type { ConstPtr, c_int, c_int64, c_uint, c_uint16, c_uint64, c_ulong } from "c:types";
import {
  CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW, GetModuleHandleW,
  KillTimer, PostQuitMessage, RegisterClassExW, SetTimer, TranslateMessage,
} from "c:win32";
import type { HWND, MSG, WNDCLASSEXW } from "c:win32";

const WM_CREATE = 0x0001;
const WM_DESTROY = 0x0002;
const WM_TIMER = 0x0113;

let created = 0;
let destroyed = 0;
let ticks = 0;
let closedBy = "nothing";

// UTF-16 by hand, until a `string` crosses as `LPCWSTR` (W1).
function wide(text: string): ConstPtr<c_uint16> {
  const out = malloc<c_uint16>((text.length + 1) * 2);
  if (out === null) return wide("");
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) as c_uint16;
  out[text.length] = 0 as c_uint16;
  return out;
}

async function closeLater(hwnd: HWND): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 30));
  if (closedBy !== "nothing") return;
  closedBy = "typescript";
  KillTimer(hwnd, 1n as c_uint64);
  DestroyWindow(hwnd);
}

function procedure(hwnd: HWND, message: c_uint, wParam: c_uint64, lParam: c_int64): c_int64 {
  if (message === WM_CREATE) created++;
  if (message === WM_TIMER) {
    ticks++;
    if (ticks === 200 && closedBy === "nothing") {
      closedBy = "failsafe";
      KillTimer(hwnd, wParam);
      DestroyWindow(hwnd);
    }
    return 0n as c_int64;
  }
  if (message === WM_DESTROY) {
    destroyed++;
    PostQuitMessage(0 as c_int);
    return 0n as c_int64;
  }
  return DefWindowProcW(hwnd, message, wParam, lParam);
}

function main(): void {
  const instance = GetModuleHandleW(null);
  const name = wide("NtsWindow");
  const cls = local<WNDCLASSEXW>();
  cls[0].cbSize = 80 as c_uint;
  cls[0].lpfnWndProc = procedure;
  cls[0].hInstance = instance;
  cls[0].lpszClassName = name;
  if (RegisterClassExW(cls) === 0) {
    report("RegisterClassExW failed");
    return;
  }
  const hwnd = CreateWindowExW(0n as c_ulong, name, wide("nts"), 0n as c_ulong,
    0 as c_int, 0 as c_int, 320 as c_int, 240 as c_int, null, null, instance, null);
  if (hwnd === null) {
    report("CreateWindowExW failed");
    return;
  }
  SetTimer(hwnd, 1n as c_uint64, 10 as c_uint, null);
  void closeLater(hwnd);
  const msg = local<MSG>();
  while (GetMessageW(msg, null, 0 as c_uint, 0 as c_uint) > 0) {
    TranslateMessage(msg);
    DispatchMessageW(msg);
  }
  report("created=" + String(created) + " destroyed=" + String(destroyed) + " by=" + closedBy);
}

main();
