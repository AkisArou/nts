// A private class alone on an interface's layout must keep its own name.
// No plain record is allocated, and the class is not exported: publication
// cannot explain its descriptor. The separate control changes only the
// interface's field name, giving the class a layout named for itself.
// The uncaught throw ends this program, so the control has its own fixture:
// a-private-class-on-its-own-layout-keeps-its-name.
interface Earlier { message: string; code: number }
export function readEarlier(value: Earlier): string { return value.message; }
class PrivateFailure {
  message: string;
  code: number;
  constructor(message: string) { this.message = message; this.code = 17; }
}
throw new PrivateFailure("private failure");
