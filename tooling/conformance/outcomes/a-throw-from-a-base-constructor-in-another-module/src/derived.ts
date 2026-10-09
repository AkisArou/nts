// The derived class in another module, as AdwGroupNode is in adw/children.ts.
import { Base } from "./base.ts";

export class Derived extends Base {
  constructor(type: string) {
    super(type);
  }
}

export function create(type: string): Derived {
  return new Derived(type);
}
