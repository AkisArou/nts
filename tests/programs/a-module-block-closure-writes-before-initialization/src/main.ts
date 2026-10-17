// expect-ir: all: no global.get in writeReadyBinding
// expect-ir: all: no global.get in readReadyBinding
// Main 585d: 58 of 145 calls disagree; the three controls agree.
export { writeSubject, writeControl, readSubject, readControl, loopControl } from "./case.js";
