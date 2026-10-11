// TypeScript accepts a narrowed method parameter through bivariance. An
// adapter from Animal to Dog would require a downcast, which is unsupported.
import { Dog, type Sized } from "./common.ts";
class Narrowed {
  marker = 7;
  size(value: Dog): number { return this.marker + value.extra; }
}
const checked: Sized = new Narrowed();
export function narrowed(n: number): number { return checked.size(new Dog()) + n; }
