// The helper owns the reference. The scoped callback only borrows it, using
// the existing C closure contract; returned method outputs have their own references.
/**
 * @ntsHeader "desktop.h"
 * @ntsLibrary shell32
 * @ntsLibrary ole32
 */
declare module "c:desktop" {
  import type { ScopedClosure } from "c:types";
  import type { c_uint } from "@nts/scalars";
  import type { IShellFolder } from "c:Windows.Win32.UI.Shell";

  export function desktop_release_count(): c_uint;
  export function with_desktop(callback: ScopedClosure<(folder: IShellFolder) => void>): c_uint;
}
