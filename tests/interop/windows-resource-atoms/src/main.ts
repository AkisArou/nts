import { IDC_ARROW, IDI_APPLICATION, RT_HTML, LoadCursorW, LoadIconW } from "c:Windows.Win32.UI.WindowsAndMessaging";
import {
  EnumResourceLanguagesExW, EnumResourceLanguagesW, EnumResourceNamesExW, EnumResourceNamesW, EnumResourceTypesExW,
  EnumResourceTypesW, FindResourceW, LoadLibraryW, RESOURCE_ENUM_LN, SizeofResource,
} from "c:Windows.Win32.System.LibraryLoader";
import { FreeLibrary } from "c:Windows.Win32.Foundation";
import type { BOOL, HMODULE } from "c:Windows.Win32.Foundation";
import { pointerBits } from "c:memory";
import type { ConstPtr, Ptr } from "c:types";
import type { BigInt64, Uint16 } from "@nts/scalars";

// Enumeration hands each callback an atom wherever a resource is numbered
// (`#23` is RT_HTML, `#32512` the fixture's numbered name). A callback asks
// the pointer's bits before it reads -- winuser.h's IS_INTRESOURCE -- and
// copies text while the pointer is lent to it. An atom read through would
// fault: the low 64 KiB of a Windows address space is never mapped.
function describe(p: ConstPtr<Uint16>): string {
  if ((pointerBits(p) >> 16n) === 0n) return `#${Number(pointerBits(p) & 0xffffn)}`;
  let text = "";
  for (let i = 0; p[i] !== 0; i++) text += String.fromCharCode(p[i]);
  return text;
}

// Each level hands its borrowed pointers straight to the next, so no pointer
// is ever made from an integer. `lParam` 0 takes the plain APIs, 1 the Ex.
let found = "";
function onLanguage(hModule: HMODULE, lpType: ConstPtr<Uint16>, lpName: ConstPtr<Uint16>, wLanguage: Uint16, lParam: BigInt64): BOOL {
  found += ` ${describe(lpType)}/${describe(lpName)}@${wLanguage}`;
  return 1;
}
function onName(hModule: HMODULE, lpType: ConstPtr<Uint16>, lpName: Ptr<Uint16>, lParam: BigInt64): BOOL {
  return lParam === 0n
    ? EnumResourceLanguagesW(hModule, lpType, lpName, onLanguage, lParam)
    : EnumResourceLanguagesExW(hModule, lpType, lpName, onLanguage, lParam, RESOURCE_ENUM_LN, 0);
}
let types: string[] = [];
function onType(hModule: HMODULE, lpType: Ptr<Uint16>, lParam: BigInt64): BOOL {
  types.push(describe(lpType));
  return lParam === 0n
    ? EnumResourceNamesW(hModule, lpType, onName, lParam)
    : EnumResourceNamesExW(hModule, lpType, onName, lParam, RESOURCE_ENUM_LN, 0);
}

const cursor = LoadCursorW(null, IDC_ARROW);
const icon = LoadIconW(null, IDI_APPLICATION);
if (cursor === null || icon === null) throw new Error("shared cursor/icon missing");
// System-owned shared handles are never destroyed by this program.
const module = LoadLibraryW("nts-resource-fixture.dll");
if (module === null) throw new Error("resource fixture did not load");
const tt = FindResourceW(module, "NTS_NAMED", "NTS_TYPE");
const ta = FindResourceW(module, "NTS_HTML", RT_HTML);
const at = FindResourceW(module, IDI_APPLICATION, "NTS_TYPE");
const aa = FindResourceW(module, IDI_APPLICATION, RT_HTML);
if (tt === null || ta === null || at === null || aa === null) throw new Error("resource overload mismatch");
if (SizeofResource(module, tt) !== 2 || SizeofResource(module, ta) !== 2 ||
    SizeofResource(module, at) !== 2 || SizeofResource(module, aa) !== 2) throw new Error("resource payload size");
console.log("cursor=true icon=true text/text=2 text/atom=2 atom/text=2 atom/atom=2");
if (EnumResourceTypesW(module, onType, 0n) === 0) throw new Error("plain enumeration stopped");
console.log(`plain: types=${types.join(",")}${found}`);
types = [];
found = "";
if (EnumResourceTypesExW(module, onType, 1n, RESOURCE_ENUM_LN, 0) === 0) throw new Error("Ex enumeration stopped");
console.log(`ex: types=${types.join(",")}${found}`);
if (FreeLibrary(module) === 0) throw new Error("resource fixture did not unload");
