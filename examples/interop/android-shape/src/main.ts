// Both directions, in the shape Android imposes.
//
// Three things here cannot be shown anywhere else in this tree: a TypeScript
// class extending a Java one, a value-returning callback on the calling thread,
// and a void callback arriving from a thread we do not own.

import { View, Loader, Rect } from "java:com.example.ui";

// --- TypeScript extending a Java class ------------------------------------
//
// Needs `Layout.base` to name a foreign type. The JVM verifier does not accept
// passing a `Panel` where `Widget` is declared unless `Panel`'s `super_class`
// really is `com/example/ui/View`, so this is not a cast -- it is a real
// superclass in the emitted class file.

class Panel extends View {
  measured: number = 0;

  /** Overriding a PROTECTED Java method -- the Android custom-view idiom, and
   *  inexpressible until the binding surfaced `protected` at all. */
  protected override onDraw(bounds: Rect): void {
    this.measured = bounds.width();
  }

  override onMeasure(width: number, height: number): void {
    // The primitive overload, so no `Rect` is constructed at all.
    this.setBounds(0, 0, width, height);
    this.measured = width;
  }
}

// --- TypeScript implementing a Java interface -----------------------------
//
// The other half of a functional interface. A Java SAM accepts **both** a
// lambda and an object that implements it, so the binding surfaces both:
// `setOnTouch` takes `View.OnTouch | ((x, y) => boolean)`.
//
// A closure is the right choice when there is no state. This is the shape for
// when there is -- a listener that counts, which a closure would have to
// capture a cell for.
class TouchCounter implements View.OnTouch {
  seen: number = 0;

  onTouch(x: number, y: number): boolean {
    this.seen = this.seen + 1;
    return x >= 0 && y >= 0;
  }
}

export function main(): string {
  const panel = new Panel();

  // An implementing object, passed where Java wants the interface -- and
  // dispatched through, because installing a listener is not calling one. This
  // line used to be absent and `counter.seen` stayed 0: the closure below
  // replaced the listener before Java ever reached this one, so the object
  // path was constructed, passed, verified by javac, and never run.
  const counter = new TouchCounter();
  panel.setOnTouch(counter);
  const byObject = panel.dispatchTouch(1, 1);

  // --- same thread, returns a value ---------------------------------------
  // Runs on the calling thread and its answer is used immediately. Possible
  // only because the environment is installed on that thread.
  panel.setOnTouch((x: number, y: number): boolean => {
    // A foreign public field read, straight through the binding table.
    return x < panel.right && y < panel.bottom;
  });

  panel.onMeasure(100, 50);
  const consumed = panel.dispatchTouch(10, 10);

  // --- foreign thread, returns nothing ------------------------------------
  //
  // **This runs on the loader's thread, not on ours.** The plan says a void
  // callback from a foreign thread is posted to `NtsInbox` and drained on our
  // lane; that is not what is emitted. `Closure1.onBytes` wraps the `byte[]`
  // and calls straight into `Program.Closure1$call`, and **no emitted class in
  // this project references `NtsInbox` at all** -- `javap -c` says zero, five
  // classes out of five.
  //
  // It is `void`, so nothing is lost on the way back. What is not established
  // is the thing the inbox exists for: our runtime is a single lane, and this
  // body touches it from a thread we do not own. It works here because the
  // body only writes one number. Corrected 2026-09-15; the claim had no
  // witness and ran for as long as nothing compiled this file.
  Loader.load("payload", (data: Uint8Array): void => {
    const head = data.subarray(0, 4); // a view, not a copy
    fromLoader = head.length;
  });

  // --- the overload that costs an allocation, for contrast ----------------
  // Building a Rect just to pass it is the form to avoid; it is here so the
  // difference is visible rather than described.
  const bounds = new Rect(0, 0, 10, 10);
  panel.setBounds(bounds);

  return `${panel.measured} ${consumed ? 1 : 0} ${byObject ? 1 : 0} ${counter.seen} ${panel.right}`;
}

/// What the loader's callback recorded. Read by the Java driver *after* waiting
/// for it, because `Loader.load` returns as soon as the thread starts -- so
/// reading this at the end of `main` would be a race, and would have read 0.
let fromLoader = 0;

export function loaded(): number {
  return fromLoader;
}
