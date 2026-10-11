export function earlyType(n: number): string {
  function read() { return typeof x; }
  const seen = read();
  var x = n;
  return seen;
}

export function lateType(n: number): string {
  function readLate() { return typeof x; }
  var x = n;
  return readLate();
}

export function uninitialized(): string {
  function readEmpty() { return typeof x; }
  var x: number;
  return readEmpty();
}

export function assignedBeforeDeclaration(n: number): string {
  function readAssigned() { return typeof x; }
  x = n;
  const seen = readAssigned();
  var x: number;
  return seen;
}

export function bothStates(n: number): string {
  function readBoth() { return typeof x; }
  const before = readBoth();
  var x = n;
  return before + ":" + readBoth();
}

export function parenthesized(n: number): string {
  function readParens() { return typeof ((x)); }
  const seen = readParens();
  var x = n;
  return seen;
}

export function hoistedLate(n: number): string {
  var x = n;
  function readHoistedLate() { return typeof x; }
  return readHoistedLate();
}

export function earlyArrow(n: number): string {
  const read = () => typeof value;
  const before = read();
  var value = n;
  return before + ":" + read();
}

export function throughCallback(n: number): string {
  function readThroughCallback() { return typeof value; }
  const before = invokeTypeReader(readThroughCallback);
  var value = n;
  return before + ":" + invokeTypeReader(readThroughCallback);
}

function invokeTypeReader(read: () => string): string { return read(); }

export function earlyBoolean(flag: boolean): string {
  function readBoolean() { return typeof value; }
  const before = readBoolean();
  var value = flag;
  return before + ":" + readBoolean();
}

export function earlyString(text: string): string {
  function readString() { return typeof value; }
  const before = readString();
  var value = text;
  return before + ":" + readString();
}

export function repeated(flag: boolean): string {
  function runOne() {
    function readRepeated() { return typeof value; }
    const before = readRepeated();
    var value = flag;
    return before + ":" + readRepeated();
  }
  return runOne() + "/" + runOne();
}

export function parameterControl(n: number): string {
  function readParameter() { return typeof n; }
  var n: number;
  return readParameter();
}

export function conditional(n: number): string {
  function readConditional() { return typeof value === "number" ? "number" : "missing"; }
  const before = readConditional();
  var value = n;
  return before + ":" + readConditional();
}
