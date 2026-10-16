// The potential failure arm of String() leaves through finally, but its
// assignments must not become the success arm's compiler bindings. A catch
// body has popped its handler while its finally is still on the exit stack.
// Clean c8ee agrees; the first printer-raising candidate fe8 was invalid HIR
// (NotDominated) even though these inputs always make the printer succeed.
class Printer {
  n: number;
  constructor(n: number) { this.n = n; }
  toString(): string { if (this.n < 0) throw 22; return "ok"; }
}

export function successfulConversion(n: number): number {
  let value = 1;
  try { throw 0; }
  catch { const text = String(new Printer(n & 1)); value += text.length; }
  finally { value += 100; }
  return value;
}

// One difference: invoke the same printer explicitly, without an implicit
// conversion's failure arm. It returns 103, as does the subject in Node.
export function explicitControl(n: number): number {
  let value = 1;
  try { throw 0; }
  catch { const text = new Printer(n & 1).toString(); value += text.length; }
  finally { value += 100; }
  return value;
}

export function finallyReassigns(n: number): number {
  let value = 1;
  let seen = 0;
  try { throw 0; }
  catch {
    const text = String(new Printer(n & 1));
    seen = value;
    value += text.length;
  } finally { value = 77; }
  return seen * 100 + value;
}

export function reassignExplicitControl(n: number): number {
  let value = 1;
  let seen = 0;
  try { throw 0; }
  catch {
    const text = new Printer(n & 1).toString();
    seen = value;
    value += text.length;
  } finally { value = 77; }
  return seen * 100 + value;
}
