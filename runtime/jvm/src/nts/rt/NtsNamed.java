package nts.rt;

/**
 * What a function the program made is called: `f.name` where the type does
 * not settle it, and the name in a function's text.
 *
 * <p>Every generated class with an entry in the compiler's table
 * (`hir::Program::function_names`) implements it -- a closure class, a class
 * used as a value -- the same answer `runtime/c` reads off a descriptor's
 * `function_name`. A class without one is a method whose key is computed at
 * run time, or no function at all, and {@link NtsValue#functionName} refuses
 * it by name.
 */
public interface NtsNamed {
    String nts$name();
}
