//! What a name becomes in an object file.
//!
//! # Why this is shared
//!
//! An exported symbol is an ABI a human links against, so it cannot depend on
//! which backend produced the object. The mangling was the C backend's, which
//! was right while there was one backend and wrong the moment there were two:
//! `module#init` became `module__init` in the C output and `@"module#init"` in
//! the LLVM output, and a driver could link against exactly one of them.
//!
//! So the rule lives here and both backends read it. It is still *C's* rule --
//! reserved words, header collisions, punctuation no C identifier may carry --
//! and that is fine: the linkage name has to be a name every toolchain on the
//! way to an executable can carry, and C's is the narrowest of them.

/// Identifiers C will not let us use for a function.
///
/// C11 keywords, the macros `<stdbool.h>` defines, `main`, and the standard
/// library names declared by the headers the runtime needs. TypeScript has no
/// such restriction, so `function double()` and `function div()` are both
/// perfectly good source that cannot be spelled that way in C.
///
/// # The real fix, not done here
///
/// This list is bounded only by which headers the generated file includes, and
/// that is the wrong thing to depend on: adding one header could rename a user's
/// exported function. The runtime belongs in its own translation unit, with a
/// header declaring only the types and prototypes -- then the generated file
/// includes no system headers at all and the collision surface is the runtime's
/// own `nts_` prefix. That is a separate slice; this list makes the current
/// arrangement correct in the meantime.
const RESERVED: &[&str] = &[
    // C11 keywords and the macros `<stdbool.h>` defines. Header-declared names
    // are handled separately, by `collides_with_a_header`.
    "alignas",
    "alignof",
    "auto",
    "bool",
    "break",
    "case",
    "char",
    "const",
    "constexpr",
    "continue",
    "default",
    "do",
    "double",
    "else",
    "enum",
    "extern",
    "false",
    "float",
    "for",
    "goto",
    "if",
    "inline",
    "int",
    "long",
    "main",
    "nullptr",
    "register",
    "restrict",
    "return",
    "short",
    "signed",
    "sizeof",
    "static",
    "static_assert",
    "struct",
    "switch",
    "thread_local",
    "true",
    "typedef",
    "typeof",
    "union",
    "unsigned",
    "void",
    "volatile",
    "while",
];

/// Names the headers a generated file includes already use.
///
/// A generated file includes `nts_runtime.h` and nothing else, and that header
/// includes `<math.h>`, `<stdbool.h>`, `<stddef.h>` and `<stdint.h>`. Between
/// them that is the entire collision surface -- it no longer picks up the
/// hundreds of names `<stdio.h>` and `<stdlib.h>` declare, which is why the
/// runtime moved to its own translation unit.
///
/// A predicate rather than a list, because `<math.h>` declares every function in
/// three widths: `pow`, `powf`, `powl`. Listing all of them by hand is how
/// `nan` came to be missing, which a TypeScript function called `nan` then
/// found. Stripping the width suffix and asking about the stem covers all three
/// and cannot go stale.
///
/// A false positive costs an underscore on a name that did not need one. That is
/// the right direction to be wrong in: the alternative is a generated file that
/// does not compile, and the mangling is reversible by inspection either way.
/// Every `<math.h>` function and classification macro, in its `double`
/// spelling.
const MATH: &[&str] = &[
    "acos",
    "acosh",
    "asin",
    "asinh",
    "atan",
    "atan2",
    "atanh",
    "cbrt",
    "ceil",
    "copysign",
    "cos",
    "cosh",
    "erf",
    "erfc",
    "exp",
    "exp2",
    "expm1",
    "fabs",
    "fdim",
    "floor",
    "fma",
    "fmax",
    "fmin",
    "fmod",
    "fpclassify",
    "frexp",
    "hypot",
    "ilogb",
    "isfinite",
    "isgreater",
    "isgreaterequal",
    "isinf",
    "isless",
    "islessequal",
    "islessgreater",
    "isnan",
    "isnormal",
    "isunordered",
    "ldexp",
    "lgamma",
    "llrint",
    "llround",
    "log",
    "log10",
    "log1p",
    "log2",
    "logb",
    "lrint",
    "lround",
    "modf",
    "nan",
    "nearbyint",
    "nextafter",
    "nexttoward",
    "pow",
    "remainder",
    "remquo",
    "rint",
    "round",
    "scalbln",
    "scalbn",
    "signbit",
    "sin",
    "sinh",
    "sqrt",
    "tan",
    "tanh",
    "tgamma",
    "trunc",
];
/// Type names from `<stdint.h>` and `<stddef.h>`. Not functions, but a
/// function called `size_t` is still a redeclaration.
const TYPES: &[&str] = &[
    "int8_t",
    "int16_t",
    "int32_t",
    "int64_t",
    "uint8_t",
    "uint16_t",
    "uint32_t",
    "uint64_t",
    "intptr_t",
    "uintptr_t",
    "intmax_t",
    "uintmax_t",
    "size_t",
    "ptrdiff_t",
    "wchar_t",
    "offsetof",
    "NULL",
];

/// `<string.h>`, which the runtime includes for `memcpy`.
///
/// `basename` is here and `dirname` is not, and the difference is the point:
/// glibc declares `basename` in `<string.h>` under `_GNU_SOURCE`, so it
/// collides with a header this file actually includes. `dirname` lives in
/// `<libgen.h>`, which it does not -- and renaming a user's exported
/// function on account of a header nobody included is the failure mode the
/// note above describes. Both were hit on the first real module, which is
/// the evidence that the *general* answer is §27.1's namespaced ABI rather
/// than a longer list.
const STRING: &[&str] = &[
    "memchr",
    "memcmp",
    "memcpy",
    "memmove",
    "memset",
    "strcat",
    "strchr",
    "strcmp",
    "strcoll",
    "strcpy",
    "strcspn",
    "strerror",
    "strlen",
    "strncat",
    "strncmp",
    "strncpy",
    "strpbrk",
    "strrchr",
    "strspn",
    "strstr",
    "strtok",
    "strxfrm",
    "strdup",
    "strndup",
    "strnlen",
    "strcasecmp",
    "strncasecmp",
    "basename",
    "index",
    "rindex",
];

fn collides_with_a_header(name: &str) -> bool {
    if MATH.contains(&name) || TYPES.contains(&name) || STRING.contains(&name) {
        return true;
    }
    // `powf` and `powl` are the same declaration in another width.
    let stem = name
        .strip_suffix('f')
        .or_else(|| name.strip_suffix('l'))
        .unwrap_or(name);
    MATH.contains(&stem)
}

/// The C spelling of a function name.
///
/// Appending an underscore is the whole rule: it is reversible by inspection,
/// which matters because an exported name is an ABI that a human will link
/// against. Names this backend generates itself (`v0`, `t0`, `b0`) are mangled
/// the same way, so a function called `v0` cannot shadow a parameter.
#[must_use]
pub fn c_identifier(name: &str) -> String {
    // A qualified name carries punctuation no C identifier may: `Class#method`
    // for a method, `Class.method` for a static one, `Class<id>` for one
    // instantiation of a generic class, and `name@module` for a function whose
    // plain name another module also declares. None can appear in a TypeScript
    // identifier, which is why they were chosen, and each gets its *own*
    // spelling here so that two different qualified names cannot become one C
    // name -- one class may declare `static foo()` and `foo()` together.
    //
    // `<` and `>` map the way `object_type_name` maps them, because the struct
    // and its methods have to agree.
    if name.contains(['#', '.', '<', '>', '@']) {
        return name
            .replace('#', "__")
            .replace('.', "___")
            .replace('@', "____")
            .replace(|c: char| !c.is_alphanumeric() && c != '_', "_");
    }
    let generated = matches!(name.as_bytes().first(), Some(b'v' | b't' | b'b'))
        && name.len() > 1
        && name[1..].bytes().all(|b| b.is_ascii_digit());

    if RESERVED.contains(&name)
        || collides_with_a_header(name)
        || generated
        || name.starts_with('_')
    {
        format!("{name}_")
    } else {
        name.to_string()
    }
}

/// What a name becomes on the JVM.
///
/// # A second rule, deliberately beside the first
///
/// [`c_identifier`] exists because a native linkage name has to survive every
/// toolchain on the way to an executable, and C's is the narrowest of them. The
/// JVM's constraint is a different one and much looser: JVMS 4.2.2 forbids
/// exactly `.`, `;`, `[` and `/` in a member name, plus `<` and `>` outside the
/// two names the format reserves. There are no reserved words, because a class
/// file is not Java source -- `int`, `class` and `new` are all perfectly good
/// method names, and a TypeScript program that uses one needs no rescuing.
///
/// The two rules live in one file so the difference between them is visible in
/// a diff. Applying C's rule here would rename functions for a constraint the
/// JVM does not have, and the two artifacts would disagree about what a program
/// exports.
#[must_use]
pub fn jvm_member_name(raw: &str) -> String {
    raw.chars()
        .map(|ch| match ch {
            // `module#init` becomes `module$init`: `#` is legal in a member
            // name and reads badly in a stack trace, which is the one place a
            // generated name is shown to a person.
            '.' | ';' | '[' | '/' | '<' | '>' | '#' => '$',
            other => other,
        })
        .collect()
}

/// A class's binary name: the same rule, plus the package this backend owns.
///
/// `nts/gen` for a program's own classes and `nts/rt` for the runtime, so a
/// generated class can never collide with a platform one however a TypeScript
/// file is named.
#[must_use]
pub fn jvm_class_name(raw: &str) -> String {
    format!("nts/gen/{}", jvm_member_name(raw))
}

#[cfg(test)]
mod jvm_tests {
    use super::*;

    #[test]
    fn the_characters_the_format_forbids_are_the_only_ones_replaced() {
        assert_eq!(jvm_member_name("resolve@win32"), "resolve@win32");
        assert_eq!(jvm_member_name("module#init"), "module$init");
        assert_eq!(jvm_member_name("a/b.c;d[e"), "a$b$c$d$e");
    }

    #[test]
    fn a_java_keyword_is_a_perfectly_good_method_name() {
        // The point of not reusing `c_identifier`: these need no escaping on a
        // machine that never sees Java source.
        for name in ["int", "class", "new", "double", "div"] {
            assert_eq!(jvm_member_name(name), name);
        }
    }

    #[test]
    fn a_class_is_packaged_where_nothing_platform_can_collide() {
        assert_eq!(jvm_class_name("Point"), "nts/gen/Point");
    }
}
