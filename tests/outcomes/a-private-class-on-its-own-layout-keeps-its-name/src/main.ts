// Control for a-private-class-prints-its-interface-layout-name. Only the
// interface field changes, so the private class has its own physical layout.
// Its uncaught throw must print PrivateFailure, just as node does.
interface Earlier { earlierMessage: string; code: number }
export function readEarlier(value: Earlier): string { return value.earlierMessage; }
class PrivateFailure {
  message: string;
  code: number;
  constructor(message: string) { this.message = message; this.code = 17; }
}
throw new PrivateFailure("private failure");
