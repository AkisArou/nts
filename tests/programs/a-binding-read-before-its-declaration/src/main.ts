// Module bindings become ready individually. A read before then throws even
// when its value can be folded; a later-only reader needs no readiness check.
function attempt(run: () => number): number {
  try {
    run();
    return 0;
  } catch (error) {
    return error instanceof ReferenceError ? 1 : 2;
  }
}

function readCounter(): number { return counter + 1; }
const namedResult = attempt(readCounter);
let counter = 4;
function laterReader(): number { return counter; }
const laterResult = laterReader();

function readFolded(): number { return folded * 2; }
const foldedResult = attempt(readFolded);
const folded = 11;

function invoke(run: () => number): number { return run(); }
const initialCallback = (): number => 0;
invoke(initialCallback);
// This value did not exist at the unknown call above.
const futureCallback = (): number => futureValue * 2;
const futureValue = 7;
const futureResult = invoke(futureCallback);

// Reusing an already examined caller must consider a newly supplied value.
const secondCallback = (): number => secondValue + 1;
const repeatedResult = attempt(() => invoke(secondCallback));
const secondValue = 8;

function readFirst(): number { return first; }
const first = 11, second = readFirst();

function readPatternFirst(): number { return patternFirst; }
const [patternFirst, patternSecond = readPatternFirst()] = [5];

let directResult = 0;
try {
  // @ts-expect-error -- this read deliberately precedes initialization
  direct;
} catch (error) {
  directResult = error instanceof ReferenceError ? 1 : 2;
}
let direct = 9;

let typeofResult = 0;
try {
  // @ts-expect-error -- typeof still throws for an uninitialized lexical binding
  typeof typeofTarget;
} catch (error) {
  typeofResult = error instanceof ReferenceError ? 1 : 2;
}
const typeofTarget = 13;

let effectCount = 0;
function effect(): number { effectCount += 1; return 42; }
let writeResult = 0;
try {
  // @ts-expect-error -- PutValue throws after evaluating the right hand side
  writeTarget = effect();
} catch (error) {
  writeResult = error instanceof ReferenceError ? 1 : 2;
}
let writeTarget = 17;

let selfValue: number = attempt((): number => selfValue);

function Symbol(n: number): number { return shadowedValue + n; }
const shadowedResult = attempt(() => Symbol(0));
const shadowedValue = 5;

let conditionResult = 0;
try {
  // @ts-expect-error -- folding this condition must preserve its exception
  if (futureFlag) conditionResult = 3;
} catch (error) {
  conditionResult = error instanceof ReferenceError ? 1 : 2;
}
const futureFlag = true;

const classResult = attempt(() => new LaterClass().value);
class LaterClass { value = 17; }
class InnerName { static ready = typeof InnerName === "function" ? 1 : 0; }

let outerDuringStatic = 0;
function readOuterClass(): string { return typeof StaticClass; }
class StaticClass {
  value = 19;
  static {
    try {
      readOuterClass();
      outerDuringStatic = 2;
    } catch (error) {
      outerDuringStatic = error instanceof ReferenceError ? 1 : 3;
    }
  }
}
const afterStaticClass = attempt(() => new StaticClass().value);

class StaticCallback { static read(): number { return methodValue; } }
const methodResult = attempt(StaticCallback.read);
const methodValue = 23;

class LaterStaticCallback { static read(): number { return laterMethodValue; } }
invoke(initialCallback);
const laterMethodValue = 29;
const laterMethodResult = attempt(LaterStaticCallback.read);

const aliasResult = attempt(() => callableAlias());
const callableAlias = (): number => 37;

let initializerResult = 0;
try {
  // @ts-expect-error -- an initializer cannot fold away a binding access's throw
  const computed = laterInitializer + 1;
  initializerResult = computed;
} catch (error) {
  initializerResult = error instanceof ReferenceError ? 1 : 2;
}
const laterInitializer = 41;

let loopPatternResult = 0;
for (var [, , ...loopRest] = [1, 2]; loopPatternResult < 1;) {
  loopPatternResult += loopRest.length + 1;
}

// Code can run before a var closure without reading its hoisted undefined.
function unrelated(): number { return 1; }
const unrelatedResult = unrelated();
var varCallback = (): number => 3;
const varResult = varCallback();

export function earlyNamed(n: number): number { return namedResult + n; }
export function foldedConstant(n: number): number { return foldedResult + n; }
export function laterOnly(n: number): number { return laterResult + n; }
export function futureValueIsUnavailable(n: number): number { return futureResult + n; }
export function repeatedCaller(n: number): number { return repeatedResult + n; }
export function individualBindings(n: number): number { return second + n; }
export function individualPatternBindings(n: number): number { return patternSecond + n; }
export function directRead(n: number): number { return directResult + n; }
export function typeofRead(n: number): number { return typeofResult + n; }
export function earlyWrite(n: number): number { return writeResult + effectCount + n; }
export function ownInitializer(n: number): number { return selfValue + n; }
export function shadowedBuiltin(n: number): number { return shadowedResult + n; }
export function foldedCondition(n: number): number { return conditionResult + n; }
export function earlyClass(n: number): number { return classResult + n; }
export function classInnerName(n: number): number { return InnerName.ready + n; }
export function classOuterName(n: number): number { return outerDuringStatic + afterStaticClass + n; }
export function staticMethodValue(n: number): number { return methodResult + n; }
export function laterStaticMethod(n: number): number { return laterMethodResult + n; }
export function earlyCallableAlias(n: number): number { return aliasResult + n; }
export function foldedInitializer(n: number): number { return initializerResult + n; }
export function localLoopPattern(n: number): number { return loopPatternResult + n; }
export function safeVarClosure(n: number): number { return varResult + unrelatedResult + n; }
export function ordinaryControl(n: number): number { return counter + folded + direct + secondValue + n; }
