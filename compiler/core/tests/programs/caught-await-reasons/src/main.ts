// Two awaits a `try` catches, each handler reading its reason. The reason is
// only there when the promise rejected, so a resumption reads it only on the
// edge `nts_promise_is_rejected` took; the fulfilled edge reads the value.
async function settles(n: number): Promise<number> {
  if (n > 0) throw new Error(`rejected ${n}`);
  return n;
}

export async function messageOrValue(n: number): Promise<string> {
  try {
    return String(await settles(n));
  } catch (error) {
    return error instanceof Error ? error.message : "unknown";
  }
}

export async function lengthOrZero(n: number): Promise<number> {
  try {
    return await settles(n - 1);
  } catch (error) {
    return error instanceof Error ? error.message.length : 0;
  }
}
