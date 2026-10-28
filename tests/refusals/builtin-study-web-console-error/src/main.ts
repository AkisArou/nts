// expect: lowers
//
// Builtins study probe web-console-error; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: OK.
// In the control, only the console receiver changes to a source recorder.
// Source fallbacks check the call shape, not the ambient builtin's semantics.


class SourceConsole {
  output = "";
  error(value: string): void { this.output += "error:" + value + ";"; }
  warn(value: string): void { this.output += "warn:" + value + ";"; }
  info(value: string): void { this.output += "info:" + value + ";"; }
  debug(value: string): void { this.output += "debug:" + value + ";"; }
}
const sourceConsole = new SourceConsole();

export function subject(): void {
  console.error("e"); console.warn("w"); console.info("i"); console.debug("d");
}

export function control(): void {
  sourceConsole.error("e"); sourceConsole.warn("w"); sourceConsole.info("i"); sourceConsole.debug("d");
}
