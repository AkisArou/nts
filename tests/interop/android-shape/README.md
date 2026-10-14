# `android-shape` — both directions, in the shape Android imposes

No Android SDK dependency: plain Java interfaces with the same *shapes*, so this
runs on a desktop JVM in the gate and on a device unchanged.

`./build.sh` compiles the Java, runs `Demo`, **generates the declarations from
the resulting class files**, and diffs them against what is committed.
`NTS_REGENERATE=1 ./build.sh` accepts a change.

The TypeScript side **typechecks with zero errors**; what it still refuses is
the lowering of a call into Java, which needs the binding table and a foreign
layout — build items 1 and 4. Each refusal names itself:

```
a member of `HashMap`, a class this compiler has no type for
a method without a body
```

## The constraint, demonstrated instead of argued

"A cross-thread callback cannot return a value" is the sharpest limit on the
Android surface and drove the whole callback design. It had never been shown.
`Demo` shows it in four lines:

```
onTouch ran on: main (caller: main)
dispatchTouch returned: true
onBytes ran on: loader (caller: main), 7 bytes
and onBytes has no return value to give anyone.
```

`onTouch` runs **on the calling thread** and its `boolean` is used on the next
line. `onBytes` runs on `loader`, a thread we do not own, and there is nowhere
for a return value to go — the framework does not want one either, which is why
the signature is `void`.

That asymmetry is the whole design:

- **Same thread, returns a value.** Bindable *only* because `NtsEnv.CURRENT` is
  a `ThreadLocal` rather than a singleton pinned to a lane. Install an
  environment on the calling thread and the closure is a direct call.
- **Foreign thread, returns nothing.** Posted to `NtsInbox`, run on our lane,
  lossless precisely because there is no answer to lose.
- **Foreign thread, returns a value.** Refused at bind time, by name. Never
  served a placeholder, because a placeholder is a wrong answer that runs.

## The other two things only this project shows

**A TypeScript class extending a Java one.** `class Panel extends View` needs
`Layout.base` to name a foreign type — the verifier rejects passing a `Panel`
where `Widget` is declared unless `Panel`'s `super_class` really is
`com/example/ui/View`. It is a real superclass in the class file, not a cast.

**Preferring the primitive overload.** `Widget` publishes both
`setBounds(int,int,int,int)` and `setBounds(Rect)`, exactly as `Drawable` does
on the real SDK. Choosing the four-int form means no `Rect` is constructed, so
nothing escapes and there is nothing to copy. `src/main.ts` uses the wasteful
form once, deliberately, so the difference is visible rather than described.

## Refusals

`src/refused.ts` has three, each with the diagnostic: a value-returning callback
on a foreign thread, a registration from a thread with no environment, and an
override that widens a return type the verifier checks.

## Two generator bugs this project found, and neither was visible in the Java

**A functional interface took an object instead of a closure.** `setOnTouch`
surfaced as `setOnTouch(a0: View.OnTouch)` — demanding an object with an
`onTouch` property, which is neither what anybody writes nor what `javac`
accepts. A single-abstract-method interface now surfaces as a function type:

```ts
setOnTouch(a0: (a0: number, a1: number) => boolean): void;
static load(a0: string, a1: (a0: Uint8Array) => void): void;
```

That is cost 8 — *"closure to Java functional interface, eliminated"* — and it
is eliminated by **declaring it correctly** rather than by converting anything:
a closure already is an object with one method on this backend.

**Inherited fields were not surfaced at all.** `Panel extends View extends
Widget`, and `panel.right` was `TS2339 Property 'right' does not exist`. The
inheritance walk handled methods only. `android.graphics.Rect`-shaped geometry
is *exactly* public fields read through a subclass, so a generator that inherits
methods only cannot express the surface it exists for.

Both were found by **compiling** `src/main.ts` against the generated
declarations. The Java compiles cleanly either way, and reading the `.d.ts` did
not show either one.

## The matrix row that a grep said was covered and was not

"TS implements a Java interface" was matched by a **comment** containing the
word `implements`. The row was not covered: a Java interface was not *nameable*
at all — it only ever appeared inlined at a parameter as a function type, so no
TypeScript class could declare that it implements one.

A Java functional interface accepts **both** a lambda and an implementing
object, so the binding now surfaces both:

```ts
setOnTouch(a0: View.OnTouch | ((a0: number, a1: number) => boolean)): void;
```

and the interface itself is emitted as an interface:

```ts
export interface OnTouch {
  onTouch(a0: number, a1: number): boolean;
}
```

`src/main.ts` uses both — a closure where there is no state, and
`class TouchCounter implements View.OnTouch` where there is, which a closure
would need a captured cell for.
