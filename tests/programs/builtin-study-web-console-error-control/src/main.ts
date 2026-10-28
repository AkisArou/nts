// Source control for builtin-study-web-console-error. The return observes its
// operation; it is not a claim that the ambient builtin is provided.
class SourceConsole {
  output = "";
  error(value: string): void { this.output += "error:" + value + ";"; }
  warn(value: string): void { this.output += "warn:" + value + ";"; }
  info(value: string): void { this.output += "info:" + value + ";"; }
  debug(value: string): void { this.output += "debug:" + value + ";"; }
}

export function webConsoleErrorControl(): string {
  const log = new SourceConsole(); log.error("e"); log.warn("w"); log.info("i"); log.debug("d"); return log.output;
}
