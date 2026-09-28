// A pod from TypeScript: `Chirp`, a development pod `pod install` checked
// out (Podfile.lock, Pods/), which the program imports as `objc:Chirp`. No
// binding is committed and nothing runs `pod`: `nts build` binds the pod's
// public headers and compiles its sources, a private one in a directory of
// its own among them.
//
// What it checks, against `reference/main.m`, the same program in
// Objective-C compiled with the pod's sources:
//
//   song ...       an initializer with labels, and a method whose work is
//                  the pod's private class
//   bird ...       a property
//   version ...    a class method
//   hum ...        a pod written in Swift, `objc:Hum`, bound from the header
//                  Swift writes for it
//   beep ...       a pod that ships only a binary, `objc:Beep`: an
//                  `.xcframework` whose slice is linked, shipped beside the
//                  program and bound from the framework's headers
import { Beep } from "objc:Beep";
import { Chirp } from "objc:Chirp";
import { Hum } from "objc:Hum";

const chirp = new Chirp({ bird: "wren" });
console.log(`song ${chirp.song({ withNotes: 3 })}`);
console.log(`bird ${chirp.bird}`);
console.log(`version ${Chirp.version()}`);
const hum = new Hum({ tune: "la" });
console.log(`hum ${hum.hummed({ withTimes: 3 })}`);
console.log(`beep ${Beep.beepTimes(2)}`);
