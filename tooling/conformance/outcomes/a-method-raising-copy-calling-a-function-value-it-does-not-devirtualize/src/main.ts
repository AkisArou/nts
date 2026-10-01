// A method's raising copy calling a function value through a closure slot
// the value's class does not fill.
//
// `smallest()` sorts with `ascending`, a plain function passed as a value, and
// is called inside a `try` -- so eb92ee8f9 builds `Jar#smallest@raises`. In the
// original the comparator call is devirtualised to `Closure0#call`; in the
// raising copy it stays `call.closure[2]`, the raising slot, which
// `Closure0` does not fill. **C calls through the empty entry and the sort does
// not order**: `smallest` answers 5, the element pushed last, where node answers
// 1 (the `-4` arm agrees only because -4 is the minimum anyway). The JVM refuses
// the copy (NTS4001, the operand-stack accounting at the closure call). Found
// on the JVM first, from runtime/web-platform's `CookieJar#evict@raises`
// sorting with `compareDomainEviction`: "a closure call through a slot its
// type declares nothing for".
//
// Before eb92ee8f9 the guarded call refused (no raising copy for a method), so
// this is a refusal turned into a wrong answer.
//
// **Control:** the same call outside a `try`, which builds no raising copy and
// agrees.
//
// **Expected, confirmed under node:** both arms `-4`, then `1`.
function ascending(a: number, b: number): number {
  return a - b;
}

class Jar {
  items: number[] = [3, 1, 2];
  smallest(): number {
    const sorted = this.items.slice().sort(ascending);
    return sorted[0]!;
  }
}

function guarded(n: number): number {
  const jar = new Jar();
  jar.items.push(n);
  try {
    return jar.smallest();
  } catch {
    return -1;
  }
}

function unguarded(n: number): number {
  const jar = new Jar();
  jar.items.push(n);
  return jar.smallest();
}

observe("inside a try", String(guarded(-4)));
observe("inside a try, no new minimum", String(guarded(5)));
observe("outside a try (control)", String(unguarded(-4)));
done();
