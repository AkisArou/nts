// expect: NTS1100 `process.argv`
//
// **`process` is the node:process provider's, which this compiler does not
// supply yet.** docs/foundations/builtins.md gives the `process` global to
// stage 9 (node:* for native programs, through the resolver). Until then a
// read of `process.argv` is NTS1100, and this guards that boundary: the
// runtime already captures the command line (`nts_command_line_*`, by node's
// single-executable rule in docs/targets/native.md), and nothing may expose it
// to TypeScript ahead of the provider.
//
// The control, `tests/programs/process-argv-has-no-compiled-provider-control`,
// differs in one thing: the arguments come from a local array, which compiles
// and agrees with node.

export function subject(): string {
  return JSON.stringify(process.argv.slice(2));
}
