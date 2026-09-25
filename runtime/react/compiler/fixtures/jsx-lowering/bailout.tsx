// A component the React Compiler refuses -- a hook called conditionally --
// and so leaves as written; its JSX is lowered all the same.
import { useState } from "react";

export function Conditional({ on }: { on: boolean }) {
  if (on) {
    useState(0);
  }
  return <b>{on ? "on" : "off"}</b>;
}
