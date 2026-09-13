# `android-shape` — both directions, in the shape Android imposes

No Android SDK dependency: plain Java interfaces with the same *shapes*, so this
runs on a desktop JVM in the gate and on a device unchanged.

`./build.sh` compiles the Java and runs `Demo`, which needs no TypeScript at
all. The TypeScript side is the specification — it needs `nts bind` and a
foreign layout, build items 4 and 1.

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
