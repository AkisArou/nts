// What this project refuses, and why each refusal is the right answer.

import { Loader } from "java:com.example.ui";

export function refused(): void {

  // NTS4107: `Loader.load`'s callback is invoked on a foreign thread and is
  // posted to the inbox, so it runs LATER. A callback that returns a value
  // cannot be served that way -- there is nobody left to return to. Declare it
  // `void`, or move the registration to a thread that has an environment.
  //
  //   Loader.load("x", (data): boolean => data.length > 0);

  // NTS4108: `Loader.load` was registered from a thread with no environment.
  // `NtsEnv.CURRENT` is a ThreadLocal and none is installed here. This is
  // caught at bind time rather than at the first callback, because a
  // placeholder return value would be a wrong answer that runs.

  // NTS4109: `onMeasure` is declared `void` in `com.example.ui.Widget`. An
  // override cannot widen a return type the JVM verifier checks.
  //
  //   class Bad extends View { override onMeasure(w, h): boolean { return true; } }
}
