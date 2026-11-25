// Source control for tests/refusals/process-argv-has-no-compiled-provider:
// the same read over a local array where the subject reads `process.argv`.
const commandLine: string[] = ["/usr/bin/program", "program", "a", "b c"];

export function argvControl(): string {
  return JSON.stringify(commandLine.slice(2));
}
