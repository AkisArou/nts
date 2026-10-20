// expect: NTS1001 a parameter of unrepresentable type (a union of an intersection | null) is not supported by this lowering yet
//
// **A virtual function cannot take bytes C lends it.** A binding declares
// the buffer GIO hands `GOutputStream`'s `write_fn` as it declares a
// function's lent bytes -- `Counted<CBytes<"const void">, AsNumber<c_size_t>,
// "after"> | null`, the `const void *` and its count beside it -- and a call
// lends a `Uint8Array` that way. An override receives them from C, and its
// entry point refuses the parameter. It reaches every vfunc GIO declares
// with bytes: `write_fn`, `write_async`, GPollableOutputStream's
// `write_nonblocking`, GConverter's `convert`. Found by the Sdk lane writing
// the guard for an overridden vfunc's `@ntsThrows` slot, which had to use
// `flush` instead.
//
// Control beside it, which must stay clean: the same class's `flush`, a
// throwing vfunc with the same receiver and no bytes.
import { GOutputStream, g_io_error_quark, IOErrorEnum } from "c:Gio-2.0";
import type { GCancellable } from "c:Gio-2.0";
import { g_set_error_literal } from "c:GLib-2.0";
import type { GError } from "c:GLib-2.0";
import type { CBool, CBytes, Counted, Ptr } from "c:types";
import type { AsNumber, c_int, c_long, c_size_t } from "@nts/scalars";

class Counts extends GOutputStream {
  written = 0;

  vfunc_write_fn(
    buffer: Counted<CBytes<"const void">, AsNumber<c_size_t>, "after"> | null,
    cancellable?: GCancellable | null,
    error?: Ptr<GError | null> | null,
  ): AsNumber<c_long> {
    if (buffer === null) {
      g_set_error_literal(error ?? null, g_io_error_quark(), IOErrorEnum.FAILED, "no bytes");
      return -1;
    }
    this.written += buffer.length;
    return buffer.length;
  }
}

class Flushes extends GOutputStream {
  flushed = 0;

  vfunc_flush(cancellable?: GCancellable | null, error?: Ptr<GError | null> | null): CBool<c_int> {
    this.flushed++;
    return true;
  }
}

export function made(): number {
  return new Counts().written + new Flushes().flushed;
}
