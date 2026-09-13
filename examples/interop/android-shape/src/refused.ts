// What this project refuses, and where each refusal has to live.
//
// **Measured, not invented.** An earlier version of this file quoted
// `NTS41xx` codes that do not exist in the compiler. Each line below was
// written and run through `nts check` to find out what actually happens --
// and the most useful result is the one where *nothing* happens.

import { Loader, View } from "java:com.example.ui";

export function refused(view: View): void {
  // ---------------------------------------------------------------------
  // The one the type system cannot catch, and why
  // ---------------------------------------------------------------------
  //
  // `Loader.load`'s callback is `(data: Uint8Array) => void`. It is invoked on
  // a foreign thread and posted to `NtsInbox`, so it runs **later** -- there is
  // nobody left to return a value to.
  //
  // So this ought to be an error:
  //
  //   Loader.load("x", (d: Uint8Array): boolean => d.length > 0);
  //
  // **It compiles.** Zero TypeScript errors. That is not a gap in the binding,
  // it is a deliberate TypeScript rule: a value-returning function IS
  // assignable where a `void`-returning one is expected, because otherwise
  // `items.forEach(x => other.push(x))` would not typecheck.
  //
  // **Which is why the refusal has to be at bind time rather than in the
  // types.** The generator knows the interface is invoked on a foreign thread
  // and that its method returns `void`; the checker only knows the second, and
  // TypeScript has told it not to care. A binding that relied on the type
  // system here would silently accept a callback whose return value is
  // discarded, which is a wrong answer that runs.
  //
  // The same shape returning a value on the *calling* thread is fine and is
  // in `main.ts`: `setOnTouch` returns `boolean` because `NtsEnv.CURRENT` is a
  // `ThreadLocal` and an environment installed there makes it a direct call.

  // ---------------------------------------------------------------------
  // Two Java class modifiers, and TypeScript can express exactly one
  // ---------------------------------------------------------------------
  //
  // TS2511: Cannot create an instance of an abstract class.
  //
  // `Drawable` is `abstract` in the Java, and TypeScript has `abstract class`
  // -- so this is a compile error rather than an `InstantiationError` at run
  // time. 26 of 491 public classes in the sampled `android.jar` are abstract
  // *with* a public constructor, which is exactly the shape that used to
  // typecheck and could not run.
  //
  //   const d = new Drawable();
  //
  // **`final` gets no such treatment, and not for want of trying.** `Rect` is
  // final, so `class Mine extends Rect {}` is illegal Java -- the JVM rejects
  // the class at load with `VerifyError: Cannot inherit from final class`. The
  // usual TypeScript idiom for a sealed class is a private member; probed, and
  // a subclass simply inherits it and compiles clean. TypeScript has no
  // `final`, so the declaration says so in prose and the enforcement waits for
  // bind time.

  // ---------------------------------------------------------------------
  // Protected, enforced in both directions
  // ---------------------------------------------------------------------
  //
  // TS2445: Property 'onDraw' is protected and only accessible within class
  // 'View' and its subclasses.
  //
  //   view.onDraw(bounds);
  //
  // `Panel` in `main.ts` overrides the same method, which is what it is for:
  // 215 protected methods in the sampled `android.jar` sit on a class you can
  // extend, and `onDraw`, `onLayout` and `onSizeChanged` are all of them.
  // Surfacing only `public` made a custom view inexpressible.

  // ---------------------------------------------------------------------
  // Refused by the verifier, not by us
  // ---------------------------------------------------------------------
  //
  // `onMeasure` is declared `void` in `com.example.ui.Widget`. An override
  // cannot widen a return type the JVM verifier checks, so this is refused
  // before it can be wrong at run time:
  //
  //   class Bad extends View { override onMeasure(w: number, h: number): boolean { return true; } }

  void view;
}
