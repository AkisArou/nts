// Which shared bindings can a JavaScript mutation reach?
//
// Every interpreted stand-in is a live closure over a node property, so a test
// that mutates node state is observed there. The compiled binding is C, and
// whether *it* is observed depends on whether the mutation reaches the
// operating system:
//
//     process.env.X = "…"          calls uv_os_setenv, so getenv sees it
//     process.stdout.write = fn    changes a JavaScript property and nothing else
//
// The shape of a case does not decide its answer, so each binding is measured
// rather than grouped. One answer per binding covers every pinned test that
// reaches it, which is a smaller and more durable set than one answer per test.
declare function nts_write_stderr(text: string): number;
declare function nts_platform(): string;
declare function nts_stdout_is_tty(): boolean;

export function writeStderr(text: string): number {
  return nts_write_stderr(text);
}

export function platform(): string {
  return nts_platform();
}

export function stdoutIsTty(): boolean {
  return nts_stdout_is_tty();
}
