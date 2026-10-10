package nts.rt;

/**
 * How an object the program made prints: `String(o)`, `${o}`, and `o` in an
 * array's text.
 *
 * <p>Every generated class implements it from the compiler's table
 * (`hir::Program::printed`), the same answer `runtime/c` reads off a
 * descriptor's `to_string`: the class's own `toString`, the `Error` rule,
 * `"[object Object]"`, a function's text, or a refusal naming the class. A
 * method of its own rather than Java's `toString`, which Java calls implicitly
 * -- in concatenation, in a refusal's own message, in a debugger -- and which
 * must therefore never refuse.
 */
public interface NtsPrintable {
    String nts$print();
}
