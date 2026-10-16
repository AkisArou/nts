// The original six-function baseline on clean 585d41ee3 compared 174 calls:
// 87 premature writes silently succeeded on every backend; 87 ready controls
// agreed. Later matrix arms guard evaluation order and existing good paths.
// expect-ir: all: no field.get in ordinaryLocal
// expect-ir: all: no field.get in provenLateLet
// expect-ir: all: no field.get in plainVar
// expect-ir: all: no field.get in initializedLet
// Closure1 is capturedLetReady's writer: it reads its two captures (cell, n),
// with no third read of a readiness flag. The core test also pins the cell to
// one value field, so it cannot silently acquire readiness storage.
// expect-ir: all: count field.get in Closure1#call == 2
export { directLet, initializedLet, capturedLet, capturedLetReady, localRest, localRestReady, plainConst, plainClass, capturedConst, capturedClass, objectExplicit, compound, update, logical, rhsEffects, rhsThrows, repeated, finallyWrites, forOfArray, selfInitializer, patternReady, plainVar, lateCaptured, writerFinally, writerFinallyControl, ordinaryLocal, provenLateLet, forOfArrayReady, referenceMessage, referenceMessageControl, lexicalLoopEntries, shadowedTarget } from "./case.js";
