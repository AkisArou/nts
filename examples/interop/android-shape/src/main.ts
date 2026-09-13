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

  override onMeasure(width: number, height: number): void {
    // The primitive overload, so no `Rect` is constructed at all.
    this.setBounds(0, 0, width, height);
    this.measured = width;
  }
}

export function main(): void {
  const panel = new Panel();

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
  // Posted to NtsInbox and run on our lane. Lossless because it is `void`.
  Loader.load("payload", (data: Uint8Array): void => {
    const head = data.subarray(0, 4); // a view, not a copy
    report(head.length);
  });

  // --- the overload that costs an allocation, for contrast ----------------
  // Building a Rect just to pass it is the form to avoid; it is here so the
  // difference is visible rather than described.
  const bounds = new Rect(0, 0, 10, 10);
  panel.setBounds(bounds);

  report(consumed ? 1 : 0);
}

function report(n: number): void {
  // stands in for whatever the app does with it
}
