// run: check
// Unchecked JS reaches direct writes which the TypeScript checker rejects.
// Each control moves only the same declaration before the same assignment.
// On clean 585d41ee3, C/LLVM/JVM/Wasm each execute 174/6: all 87 TDZ
// subject calls answer 0 instead of node's catchable ReferenceError (1);
// all 87 initialized controls agree, with no refusals or declines.
export { directLet, initializedLet, capturedLet, capturedLetReady, localRest, localRestReady } from "./case.js";
