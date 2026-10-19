// Enums the headers spell as an enum type, crossed as the one integer
// clang says each is compatible with. Both enums here are anonymous in
// mingw's headers -- a typedef name does the naming (`typedef enum
// { ... } QUERY_USER_NOTIFICATION_STATE;`) -- so the compatible integer
// had to come from asking about the typedef name itself. A real tag
// (`enum tagFEEDBACK_TYPE`, through GetWindowFeedbackSetting) is covered
// by the binder's own tests and self-check instead: on a machine with
// no digitizer that call returns FALSE whatever the crossing, so it
// witnesses nothing here. These two are declared in headers
// <windows.h> itself reaches (shellapi.h, winuser.h); the Shell
// functions in <shlwapi.h> await the header-reach slice before a
// program's own witness can declare them.
import { CreateSyntheticPointerDevice } from "c:Windows.Win32.UI.Controls";
import { POINTER_FEEDBACK_MODE } from "c:Windows.Win32.UI.Input.Pointer";
import { QUERY_USER_NOTIFICATION_STATE, SHQueryUserNotificationState } from "c:Windows.Win32.UI.Shell";
import { POINTER_INPUT_TYPE } from "c:Windows.Win32.UI.WindowsAndMessaging";
import { local } from "c:memory";
import type { CEnum } from "c:types";
import type { c_uint, c_ulong32 } from "@nts/scalars";

function run(): string {
  const state = local<CEnum<QUERY_USER_NOTIFICATION_STATE, c_uint>>();
  state[0] = QUERY_USER_NOTIFICATION_STATE.QUNS_NOT_PRESENT;
  // The state itself is the session's, and deliberately never compared:
  // only that the call succeeded and wrote one of the enum's values.
  const quns = SHQueryUserNotificationState(state) === 0
    && state[0] >= QUERY_USER_NOTIFICATION_STATE.QUNS_NOT_PRESENT
    && state[0] <= QUERY_USER_NOTIFICATION_STATE.QUNS_APP;

  // The binding has no DestroySyntheticPointerDevice; the device is
  // owned by this process and Windows removes it when it exits.
  const device = CreateSyntheticPointerDevice(
    POINTER_INPUT_TYPE.PT_TOUCH,
    1 as c_ulong32,
    POINTER_FEEDBACK_MODE.POINTER_FEEDBACK_NONE,
  ) !== null;

  return "quns=" + String(quns) + " device=" + String(device);
}

console.log(run());
