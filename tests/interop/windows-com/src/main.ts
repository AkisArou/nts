// Obtain a borrowed classic COM interface without activation, call a method
// emitted by bind-winmd, and leave Release to the native owner after return.
import { with_desktop } from "c:desktop";
import { local } from "c:memory";
import type { ConstPtr } from "c:types";
import type { c_uint, c_ulong32 } from "@nts/scalars";
import type { ITEMIDLIST } from "c:Windows.Win32.UI.Shell.Common";

let folderBit = false;
const released = with_desktop((folder) => {
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
console.log("folder=" + String(folderBit) + " released=" + String(released));
