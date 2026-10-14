package com.example;

/**
 * Never null, said by the class file rather than by a file beside it.
 *
 * <p>Declared here because this project has no dependencies and the binder does
 * not care whose annotation it is: it matches any whose binary name ends in
 * {@code /NonNull}, which is what JSR-305, JetBrains, AndroidX and JSpecify all
 * end in. Matching the simple name rather than a fixed list is the only thing
 * that works across jars, since every ecosystem shipped its own.
 *
 * <p><b>{@code CLASS} retention, not {@code RUNTIME}.</b> The binder reads the
 * class file, not a loaded class, so {@code CLASS} is sufficient -- and it is
 * what AndroidX and JSpecify use. {@code SOURCE} would be invisible here, which
 * is the mistake this comment exists to prevent.
 */
@java.lang.annotation.Retention(java.lang.annotation.RetentionPolicy.CLASS)
@java.lang.annotation.Target({
    java.lang.annotation.ElementType.METHOD,
    java.lang.annotation.ElementType.FIELD,
    java.lang.annotation.ElementType.PARAMETER
})
public @interface NonNull {}
