import { IDC_ARROW, IDI_APPLICATION, RT_HTML, LoadCursorW, LoadIconW } from "c:Windows.Win32.UI.WindowsAndMessaging";
import { LoadLibraryW, FindResourceW, SizeofResource } from "c:Windows.Win32.System.LibraryLoader";
import { FreeLibrary } from "c:Windows.Win32.Foundation";

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
if (FreeLibrary(module) === 0) throw new Error("resource fixture did not unload");
console.log("cursor=true icon=true text/text=2 text/atom=2 atom/text=2 atom/atom=2");
