//! Shared C/LLVM native-loan guards, extending the existing metadata-byte fixture.

pub(super) const SOURCE: &str = r#"
import type { CBytes, Counted } from "c:types";
import type { Float64, Int32, Uint16 } from "@nts/scalars";
/** @ntsNoEscape bytes */
declare function count_of(bytes: Counted<CBytes, Uint16>): Float64;
export function counted(n: Int32): number {
  try {
    return count_of(new Uint8Array(n));
  } catch (error) {
    return error instanceof RangeError ? -1 : -2;
  }
}
export function lending(borrow: boolean, requested: number): number {
  const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
  const bytes = new Uint8Array(buffer);
  bytes[7] = 91;
  if (borrow) count_of(bytes.subarray(1));
  const answer = resizeBuffer(buffer, requested);
  return answer + (borrow && bytes.length > 7 ? bytes[7] : 0);
}
export function resizeBuffer(buffer: ArrayBuffer, requested: number): number {
  let failure = 0;
  try { buffer.resize(requested); }
  catch (error) {
    failure = error instanceof RangeError
      ? (error.message.includes("lent to C") ? 1 : 2) : 3;
  }
  return failure * 10000 + buffer.byteLength * 100;
}
export function transferAfterLending(borrow: boolean): number {
  const bytes = new Uint8Array(8);
  if (borrow) count_of(bytes);
  try { bytes.buffer.transfer(); return 0; }
  catch (error) { return error instanceof TypeError ? 1 : -1; }
}
"#;
pub(super) const NATIVE: &str = "#include <stdint.h>\n\
         static int calls;\n\
         int count_calls(void) { return calls; }\n\
         double count_of(const uint8_t *bytes, uint16_t n) { (void)bytes; calls++; return n; }\n";

// The NoEscape declaration above is truthful. Only this C host retains a
// pointer across a call, while it explicitly owns the backing and its view.
pub(super) const CALLER: &str = r#"
#include <stdio.h>
#include "program.h"

int count_calls(void);
static int failed;
static const uint8_t *saved;

static void check(const char *what, double got, double want) {
  if (got != want) {
    printf("FAIL %s: got %.17g want %.17g\n", what, got, want);
    failed = 1;
  }
}

static void saved_extent(bool loan, double requested, double want) {
#ifdef NTS_PROVIDER_RC
  const size_t live = nts_live_count();
  const size_t live_bytes = nts_live_bytes();
#endif
  NtsBuffer *buffer = nts_buffer_new_resizable(8, 16);
  NtsView *view = nts_view_new(buffer, 1, 7, NTS_ELEMENT_U8, false);
  nts_view_put(view, 6, 91);
  saved = loan ? nts_view_lend_bytes(view) : NULL;
  check("host resize result", resizeBuffer(buffer, requested), want);
  if (loan) {
    check("stored pointer keeps its address", saved == buffer->bytes + 1, 1);
    check("C reads its original saved extent after TS returns", saved[6], 91);
  } else {
    check("host no-loan twin stays unmarked", nts_buffer_is_lent_to_c(buffer), 0);
  }
  saved = NULL;
  nts_release((NtsHeader *)view);
  nts_release((NtsHeader *)buffer);
#ifdef NTS_PROVIDER_RC
  check("host backing references are released", nts_live_count(), live);
  check("host backing bytes are released", nts_live_bytes(), live_bytes);
#endif
}

int main(void) {
  check("3", counted(3), 3);
  check("65535", counted(65535), 65535);
  check("65536 throws", counted(65536), -1);
  check("C called twice", count_calls(), 2);
  check("loan shrink", lending(true, 4), 10891);
  check("ordinary shrink twin", lending(false, 4), 400);
  check("loan equal after ToIndex", lending(true, 8.9), 891);
  check("loan growth", lending(true, 12), 1291);
  check("maximum precedes loan hook", lending(true, 17), 20891);
  check("index precedes loan hook", lending(true, -2), 20891);
  check("loan transfer", transferAfterLending(true), 1);
  check("ordinary transfer twin", transferAfterLending(false), 0);
  check("all loan subjects reached C", count_calls(), 8);
  saved_extent(true, 4, 10800);
  saved_extent(false, 4, 400);
  saved_extent(true, 8.9, 800);
  saved_extent(true, 12, 1200);
  saved_extent(true, 17, 20800);
  saved_extent(true, -2, 20800);
  return failed;
}
"#;
