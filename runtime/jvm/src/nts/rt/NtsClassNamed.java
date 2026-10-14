package nts.rt;

/**
 * What a generated class is called in the program, where its JVM name is not
 * that: the name `runtime/c` reads off a descriptor (`nts_thrown_class`), which
 * is the class's own for a class that shares its layout and the layout's for
 * the layout's own class.
 *
 * <p>Implemented only where the two differ, and read through
 * {@link NtsRuntime#className}. A class that shares its layout is an empty
 * subclass named for both, {@code Layout__Class}, and its simple name read as
 * {@code nts: uncaught Test262Error__Test262Error} where C prints
 * {@code Test262Error}: a runner comparing the two lanes' uncaught lines saw a
 * difference that was only a name.
 */
public interface NtsClassNamed {
    String nts$class();
}
