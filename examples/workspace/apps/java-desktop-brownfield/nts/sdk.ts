import { store } from "@workspace/storage";
import { begin, elapsed } from "@workspace/telemetry";

export class Sdk {
  private readonly span = begin("session");

  remember(key: string, value: string): void { store().set(key, value); }
  sessionMillis(): number { return elapsed(this.span); }
}
