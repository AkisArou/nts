// Linux, glibc.
//
// **A placeholder, and the reason it exists is that nothing provided one.**
// Every package in this fixture names a surface in `types: [...]` and no such
// package existed anywhere in the tree, so `tsc -b tsconfig.solution.json`
// failed on all five with TS2688 -- which nothing had run, because the audits
// before this one checked the config files and never the program sources.
//
// The libc surface `runtime/native/libc.d.ts` already carries for the native lane.
//
// Empty rather than sketched: a surface with three invented declarations in it
// would be a claim about an API nobody has read. The declarations arrive from
// `nts bind` over the platform's own metadata.
//
// **The standard C surface, which every one of these platforms has.**
// `runtime/native/libc.d.ts` declares `c:types`, `c:memory`, `c:stdint`,
// `c:stddef`, `c:stdbool`, `c:stdlib` and `c:math` -- all of them standard C
// rather than anything glibc-specific -- and the native lane already compiles
// against it. Referencing the file that ships beats inventing a second copy,
// which is the duplicate this fixture exists to argue against.
//
// A published `@nts/platform-*` would carry it rather than point at it; the path
// is what a workspace inside this repository can do.
//
// **What is still absent is the platform-specific half**, which is the surface
// this package is named for: the Android framework, UIKit, Win32. Those come
// from `nts bind` over each platform's own metadata, and until then this
// declares exactly what it can stand behind.
/// <reference path="../../../../../runtime/native/libc.d.ts" />

export {};
