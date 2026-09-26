import { Base } from "./a.ts";

// The same class name as a.ts's, in another module -- the whole defect.
export class Thing extends Base {
  value(): number {
    return 2;
  }
}
