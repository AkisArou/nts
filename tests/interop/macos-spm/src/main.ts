// Swift packages from TypeScript: the Package.swift here depends on two local
// packages, which the program imports by their targets' names. Nothing is
// committed but their sources: `nts build` reads the manifests with SwiftPM's
// own reader, compiles the targets, and binds them.
//
// What it checks, against `reference/main.m`, the same program in
// Objective-C compiled with the packages' sources:
//
//   tally ...     an Objective-C target, bound from its `include/`, whose
//                 Core Foundation its linker settings name
//   blink ...     a Swift target, bound from the header Swift writes for it,
//                 whose rate is its package's C target's, `CBlink`, which
//                 includes another's header, `CBlinkCore`
//   buzz ...      a binary target downloaded by `url:`, the `.xcframework`
//                 SwiftPM extracted, shipped beside the program
import { Blink } from "objc:Blink";
import { Buzz } from "objc:Buzz";
import { Tally } from "objc:Tally";

const tally = new Tally();
tally.add(3);
tally.add(4);
console.log(`tally ${tally.count} ${tally.summary()}`);
const blink = new Blink({ times: 3 });
console.log(`blink ${blink.pattern()}`);
console.log(`blink rate ${blink.rate()}`);
console.log(`buzz ${Buzz.buzzTimes(3)}`);
