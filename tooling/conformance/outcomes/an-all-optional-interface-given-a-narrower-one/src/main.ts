// **Must stay refused, or agree with node.** `interface Both extends Slim, Extra`
// with every field optional: a `Slim` is assignable to a `Both` while holding
// one fewer slot (`params`). nts refuses the `Slim` handed to `hold(bag: Both)`
// today, which is right. An unchecked unerase would read `params` from a slot
// that does not exist.
//
// This is `compiler/core/tests/programs/copy-phantom`'s shape, driven through
// values node can answer. It is the shape that caught an unsound change on
// 2026-09-27: an arm in `narrowed()` licensed by `descends_from`, which holds
// structurally with no test run. The change passed the fixture it was written
// for, every examples differential, the JVM oracle and a two-binary census
// (+146 definitions, which was the symptom). Only a control asserting this
// case must not compile stopped it.
//
// So a change that makes the `Slim` arm compile moves this record to CHANGED,
// and the rule for re-recording it is strict. It is sound only if the answer
// agrees with node (`params` absent, -1) *and* the conversion is checked. A
// value that merely matches because the missing slot happened to read as
// absent is not evidence -- see `a-narrowed-value-assigned-to-a-new-binding`.

interface Bag {
  size?: number | undefined;
}

interface Slim extends Bag {
  level?: number | undefined;
}

interface Extra extends Bag {
  params?: number | undefined;
}

interface Both extends Slim, Extra {}

function hold(bag: Both): number {
  return bag.params ?? -1;
}

function viaSlim(n: number): number {
  const slim: Slim = { size: n, level: n + 1 };
  return hold(slim) * 1000 + n;
}

function viaBoth(n: number): number {
  const both: Both = { size: n, level: n + 1, params: 7 };
  return hold(both) * 1000 + n;
}

observe("a Slim handed to a Both", String(viaSlim(3)));
observe("a Both handed to a Both", String(viaBoth(3)));
done();
