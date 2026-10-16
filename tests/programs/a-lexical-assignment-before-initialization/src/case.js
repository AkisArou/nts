/** @param {number} n @returns {number} */
export function directLet(n) {
  let result = 0;
  try { x = n; } catch (e) { result = e instanceof ReferenceError ? 1 : 2; }
  let x = 0;
  return result;
}
/** @param {number} n @returns {number} */
export function initializedLet(n) {
  let result = 0;
  let x = 0;
  try { x = n; } catch (e) { result = e instanceof ReferenceError ? 1 : 2; }
  return result;
}
/** @param {number} n @returns {number} */
export function capturedLet(n) {
  let result = 0;
  function write() { x = n; }
  try { write(); } catch (e) { result = e instanceof ReferenceError ? 1 : 2; }
  let x = 0;
  return result;
}
/** @param {number} n @returns {number} */
export function capturedLetReady(n) {
  let result = 0;
  function write() { x = n; }
  let x = 0;
  try { write(); } catch (e) { result = e instanceof ReferenceError ? 1 : 2; }
  return result;
}
/** @param {number} n @returns {number} */
export function localRest(n) {
  let result = 0;
  try { [...x] = [n]; } catch (e) { result = e instanceof ReferenceError ? 1 : 2; }
  let x = [0];
  return result;
}
/** @param {number} n @returns {number} */
export function localRestReady(n) {
  let result = 0;
  let x = [0];
  try { [...x] = [n]; } catch (e) { result = e instanceof ReferenceError ? 1 : 2; }
  return result;
}

// Ordering, mutability precedence, repeated entries and finally regressions.
/** @param {number} n @returns {number} */
export function plainConst(n){let result=0; try { x=n; } catch(e) { result=e instanceof ReferenceError ? 1:2; } const x=0; return result;}
/** @param {number} n @returns {number} */
export function plainClass(n){let result=0; try { X=n; } catch(e) { result=e instanceof ReferenceError ? 1:2; } class X {} return result;}
/** @param {number} n @returns {number} */
export function capturedConst(n){let result=0; function write(){x=n;} try{write();}catch(e){result=e instanceof ReferenceError ? 1:2;} const x=0; return result;}
/** @param {number} n @returns {number} */
export function capturedClass(n){let result=0; function write(){X=n;} try{write();}catch(e){result=e instanceof ReferenceError ? 1:2;} class X {} return result;}
/** @param {number} n @returns {number} */
export function objectExplicit(n){let result=0; try { ({value:x}={value:n}); }catch(e){result=e instanceof ReferenceError ? 1:2;} let x=0; return result;}
/** @param {number} n @returns {number} */
export function compound(n){let effects=0;let result=0;try{x+=(effects=1);}catch(e){result=e instanceof ReferenceError ? 10:20;}let x=0;return result+effects;}
/** @param {number} n @returns {number} */
export function update(n){let result=0;try{x++;}catch(e){result=e instanceof ReferenceError ? 10:20;}let x=0;return result;}
/** @param {number} n @returns {number} */
export function logical(n){let effects=0;let result=0;try{x||=(effects=1);}catch(e){result=e instanceof ReferenceError ? 10:20;}let x=0;return result+effects;}
/** @param {number} n @returns {number} */
export function rhsEffects(n){let effects=0;let result=0;try{x=(effects=1);}catch(e){result=e instanceof ReferenceError ? 10:20;}let x=0;return result+effects;}
/** @param {number} n @returns {number} */
export function rhsThrows(n){let result=0; function rhs(){throw 22;}try{x=rhs();}catch(e){result=e===22?10:20;}let x=0;return result;}
/** @param {number} n @returns {number} */
export function repeated(n){let result=0;try{x=n;}catch(e){result+=e instanceof ReferenceError ? 1:2;}try{x=n;}catch(e){result+=e instanceof ReferenceError ? 10:20;}let x=0;return result;}
/** @param {number} n @returns {number} */
export function finallyWrites(n){let result=0;try{try{x=n;}finally{result=4;}}catch(e){result+=e instanceof ReferenceError ? 10:20;}let x=0;return result;}
/** @param {number} n @returns {number} */
export function forOfArray(n){let result=0;try{for(x of [n]){}}catch(e){result=e instanceof ReferenceError ? 1:2;}let x=0;return result;}
/** @param {number} n @returns {number} */
export function selfInitializer(n){let result=0;try{let x=(x=n);}catch(e){result=e instanceof ReferenceError ? 1:2;}return result;}
/** @param {number} n @returns {number} */
export function patternReady(n){const [x,y=x]=[n];return y;}
/** @param {number} n @returns {number} */
export function plainVar(n){x=n;var x;return x;}
/** @param {number} n @returns {number} */
export function lateCaptured(n){let x=0; function write(){x=n;}write();return x;}

/** @param {() => number} f @returns {number} */
function invokeWriter(f) { return f(); }
/** @param {number} n @returns {number} */
export function writerFinally(n) {
  function write() { let count=0;try{x=n;}finally{count+=1;}return count; }
  let x=0;
  return invokeWriter(write);
}
/** @param {number} n @returns {number} */
export function writerFinallyControl(n) {
  function write() { let count=0;try{x=n;}finally{count=1;}return count; }
  let x=0;
  return invokeWriter(write);
}

/** @param {number} n @returns {number} */
export function ordinaryLocal(n) { let x=n; x+=1; return x; }
/** @param {number} n @returns {number} */
export function provenLateLet(n) { let x=0; x=n; return x; }
/** @param {number} n @returns {number} */
export function forOfArrayReady(n) {
  let result=0;let x=0;
  try{for(x of [n]){}}catch(e){result=e instanceof ReferenceError?1:2;}
  return result;
}
/** @param {number} n @returns {string} */
export function referenceMessage(n) {
  try{x=n;}catch(e){return e instanceof ReferenceError?e.message:"other";}
  let x=0;return "no throw";
}
/** @param {number} n @returns {string} */
export function referenceMessageControl(n) {
  try{throw new ReferenceError("Cannot access 'x' before initialization");}catch(e){return e instanceof ReferenceError?e.message:"other";}
  let x=0;return "no throw";
}
/** @param {number} n @returns {number} */
export function lexicalLoopEntries(n) {
  let total=0;
  for(let i=0;i<2;i++){
    try{x=n;}catch(e){total+=e instanceof ReferenceError?1:20;}
    let x=0;
  }
  return total;
}
/** @param {number} n @returns {number} */
export function shadowedTarget(n) {
  let x=n;let result=0;
  {try{x=n;}catch(e){result=e instanceof ReferenceError?1:2;}let x=0;}
  return result;
}
