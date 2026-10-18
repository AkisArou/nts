// Real generated Clone dispatch, with native counters for the reference the
// callee transfers. No manual TS AddRef/Release and no second ownership model.
import { ownership_start, ownership_finish, ownership_counter } from "c:ownership";
import type { c_int, c_uint } from "@nts/scalars";
import type { IEnumFixture } from "c:Windows.Win32.OwnershipProbe";

let saved: IEnumFixture | null = null;
function counter(index: c_uint): number { return ownership_counter(index); }
function useSaved(): boolean {
  const value = saved;
  if (value === null) return false;
  value.Reset();
  return true;
}
function dropSaved(): void { saved = null; }
function balanced(): boolean {
  return counter(9 as c_uint) === 0 && counter(3 as c_uint) + counter(6 as c_uint) === counter(2 as c_uint) + (counter(8 as c_uint) === 0 ? 0 : 1)
    && counter(1 as c_uint) + counter(7 as c_uint) === counter(0 as c_uint) + 1;
}
function cloneCase(mode: c_int): string {
  let observed = "none";
  ownership_start(mode, (source) => {
    try {
      const value = source.Clone();
      if (value === null) observed = "null";
      else { value.Reset(); observed = "value"; }
    } catch { observed = "failed"; }
  });
  ownership_finish();
  return observed + " add=" + String(counter(2 as c_uint)) + " release=" + String(counter(3 as c_uint))
    + " live=" + String(counter(6 as c_uint)) + " calls=" + String(counter(4 as c_uint)) + " invalid=" + String(counter(9 as c_uint));
}
// RC retains the borrowed source at the conditional merge, global store, and
// later global read. Each is balanced; the owned call itself adds no AddRef.
function copyEscape(borrowed: boolean): string {
  let copied = false;
  ownership_start(0 as c_int, (source) => {
    const value = borrowed ? source : source.Clone();
    if (value !== null) {
      value.Reset();
      saved = value;
      copied = true;
    }
  });
  const escaped = useSaved();
  dropSaved();
  ownership_finish();
  return String(copied && escaped && balanced()) + " source-add=" + String(counter(0 as c_uint))
    + " result-live=" + String(counter(6 as c_uint));
}
function runOwnership(): void {
  console.log("owned " + cloneCase(0 as c_int));
  console.log("nullable " + cloneCase(1 as c_int));
  console.log("failed-canary " + cloneCase(2 as c_int));
  console.log("s-false " + cloneCase(3 as c_int));
  console.log("failed-null " + cloneCase(4 as c_int));
  console.log("copy-escape " + copyEscape(false));
  console.log("borrow-escape " + copyEscape(true));
}

runOwnership();
