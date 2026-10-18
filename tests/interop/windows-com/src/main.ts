// Obtain a borrowed classic COM interface without activation, call a method
// emitted by bind-winmd, and leave its Release to the native owner. Method outputs use compiler ownership.
import { with_desktop, desktop_release_count } from "c:desktop";
import { GetDesktopWindow } from "c:Windows.Win32.UI.WindowsAndMessaging";
import type { IShellFolder } from "c:Windows.Win32.UI.Shell";
import { local } from "c:memory";
import type { ConstPtr } from "c:types";
import type { c_uint, c_ulong32 } from "@nts/scalars";
import type { ITEMIDLIST } from "c:Windows.Win32.UI.Shell.Common";

function ownedEnumeration(folder: IShellFolder): boolean {
  const hwnd = GetDesktopWindow();
  if (hwnd === null) return false;
  // SHCONTF_FOLDERS | SHCONTF_NONFOLDERS. The metadata spells these flags DWORD.
  const items = folder.EnumObjects(hwnd, 0x60 as c_ulong32);
  if (items === null) return false;
  items.Reset();
  return true;
}
let ownedBit = false;
let ownedReleases = 0;
let folderBit = false;
const released = with_desktop((folder) => {
  const before = desktop_release_count();
  ownedBit = ownedEnumeration(folder);
  ownedReleases = desktop_release_count() - before;
  // The metadata does not mark apidl optional. cidl=0 asks about the desktop
  // itself; provide valid storage even though no item pointer is read.
  const items = local<ConstPtr<ITEMIDLIST> | null>();
  items[0] = null;
  const attributes = local<c_ulong32>();
  attributes[0] = 0x20000000 as c_ulong32; // SFGAO_FOLDER only, independent of configuration.
  folder.getAttributesOf(0 as c_uint, items, attributes);
  // Returning means HRESULT succeeded under @ntsHresult's contract. Other
  // SFGAOF bits are machine dependent and deliberately never compared.
  folderBit = (attributes[0] & 0x20000000) !== 0;
});
console.log("folder=" + String(folderBit) + " released=" + String(released) + " owned=" + String(ownedBit) + " rc-releases=" + String(ownedReleases));
