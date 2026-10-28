// Raw writes and console lines must use one encoder and flush path per stream.
// Each control differs only in using console for the middle write. Node uses
// console; compiled code calls the same runtime writer as its console intrinsic.
// This is a pattern guard; older compilers use the same
// console fallback. Direct runtime tests require the new helpers and check
// their bytes, failures and flushes. Node-facade lowering has separate fixtures.
/** @ntsAbi intrinsic */
declare function nts_write_stdout(text: string): number;
/** @ntsAbi intrinsic */
declare function nts_write_stderr(text: string): number;

function outLine(text: string): void {
  if (typeof nts_write_stdout === "function") {
    nts_write_stdout(text + "\n");
  } else {
    console.log(text);
  }
}

function errLine(text: string): void {
  if (typeof nts_write_stderr === "function") {
    nts_write_stderr(text + "\n");
  } else {
    console.error(text);
  }
}

export function stdoutOrder(seed: string): number {
  const text = seed.repeat(700) + "é\u0000😀\ud800";
  console.log("first", seed);
  outLine(text);
  console.log("last", seed);
  return text.length;
}

export function stdoutControl(seed: string): number {
  const text = seed.repeat(700) + "é\u0000😀\ud800";
  console.log("first", seed);
  console.log(text);
  console.log("last", seed);
  return text.length;
}

export function stderrOrder(seed: string): number {
  const text = seed.repeat(700) + "é\u0000😀\ud800";
  console.error("first", seed);
  errLine(text);
  console.error("last", seed);
  return text.length;
}

export function stderrControl(seed: string): number {
  const text = seed.repeat(700) + "é\u0000😀\ud800";
  console.error("first", seed);
  console.error(text);
  console.error("last", seed);
  return text.length;
}
