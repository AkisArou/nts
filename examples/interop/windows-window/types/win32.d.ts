// Hand-written, and checked against <windows.h> by the witness: the scaffolding
// `nts bind-winmd` replaces. Each declaration is the W (UTF-16) form.
/**
 * @ntsHeader <windows.h>
 */
declare module "c:win32" {
  import type { ConstPtr, Opaque, Ptr, Struct, c_int, c_int64, c_long, c_uint, c_uint16, c_uint64, c_ulong } from "c:types";

  export type HWND = Opaque<"HWND__">;
  export type HINSTANCE = Opaque<"HINSTANCE__">;
  export type HMENU = Opaque<"HMENU__">;
  export type HICON = Opaque<"HICON__">;
  export type HBRUSH = Opaque<"HBRUSH__">;

  export type TIMERPROC = (hwnd: HWND, message: c_uint, id: c_uint64, time: c_ulong) => void;
  export type WNDPROC = (hwnd: HWND, message: c_uint, wParam: c_uint64, lParam: c_int64) => c_int64;

  export type POINT = Struct<{ x: c_long; y: c_long }, "tagPOINT">;
  export type MSG = Struct<{
    hwnd: HWND | null;
    message: c_uint;
    wParam: c_uint64;
    lParam: c_int64;
    time: c_ulong;
    pt: POINT;
  }, "tagMSG">;
  export type WNDCLASSEXW = Struct<{
    cbSize: c_uint;
    style: c_uint;
    lpfnWndProc: WNDPROC;
    cbClsExtra: c_int;
    cbWndExtra: c_int;
    hInstance: HINSTANCE | null;
    hIcon: HICON | null;
    hCursor: HICON | null;
    hbrBackground: HBRUSH | null;
    lpszMenuName: ConstPtr<c_uint16> | null;
    lpszClassName: ConstPtr<c_uint16> | null;
    hIconSm: HICON | null;
  }, "tagWNDCLASSEXW">;

  export function GetModuleHandleW(name: ConstPtr<c_uint16> | null): HINSTANCE | null;
  /** Reads `cls` during the call and keeps no address into it.
   * @ntsNoEscape cls */
  export function RegisterClassExW(cls: ConstPtr<WNDCLASSEXW>): c_uint16;
  export function CreateWindowExW(
    exStyle: c_ulong, className: ConstPtr<c_uint16>, windowName: ConstPtr<c_uint16>, style: c_ulong,
    x: c_int, y: c_int, width: c_int, height: c_int,
    parent: HWND | null, menu: HMENU | null, instance: HINSTANCE | null, param: Ptr<void> | null,
  ): HWND | null;
  export function DefWindowProcW(hwnd: HWND, message: c_uint, wParam: c_uint64, lParam: c_int64): c_int64;
  export function DestroyWindow(hwnd: HWND): c_int;
  /** `null` for `callback` is documented: the timer posts WM_TIMER to `hwnd`. */
  export function SetTimer(hwnd: HWND | null, id: c_uint64, elapse: c_uint, callback: TIMERPROC | null): c_uint64;
  export function KillTimer(hwnd: HWND | null, id: c_uint64): c_int;
  export function PostQuitMessage(code: c_int): void;
  /** Reads `msg` during the call and keeps no address into it.
   * @ntsNoEscape msg */
  export function GetMessageW(msg: Ptr<MSG>, hwnd: HWND | null, min: c_uint, max: c_uint): c_int;
  /** Reads `msg` during the call and keeps no address into it.
   * @ntsNoEscape msg */
  export function TranslateMessage(msg: ConstPtr<MSG>): c_int;
  /** Reads `msg` during the call and keeps no address into it.
   * @ntsNoEscape msg */
  export function DispatchMessageW(msg: ConstPtr<MSG>): c_int64;
}
