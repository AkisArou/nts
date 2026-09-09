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

/// What `<unistd.h>`, `<fcntl.h>`, `<sys/stat.h>` and `<sys/socket.h>` declare.
///
/// The list that was missing, and its absence was a **silent wrong answer**
/// rather than a build error. `runtime/node/fs` exports `access`, and the
/// generated addon called `access(a0, a1)`, which is POSIX `access(2)`: a
/// module header pulled `<unistd.h>` in, the call
/// bound to libc's declaration, and an `NtsString *` went where a `const char *`
/// was expected. The Node lane measured it with the control that settles it --
/// the same binding exported as `probeAccess` answers `-2`, `0`, `-2` and
/// agrees with node, and as `access` answers `0` for every input. The binding
/// was right; the emitted C was calling a different function.
///
/// Nothing caught it and nothing could: no refusal, no clang error, the addon
/// links and loads and returns plausible numbers. It is the worst shape a
/// defect takes here, and it was waiting in the modules with the most native
/// surface -- `fs` has 133 bindings behind these names, and `net` and `dgram`
/// have `connect`, `listen`, `bind`, `send` and `socket`.
///
/// Names rather than headers, because the rule is about what a *linker* can
/// confuse. A TypeScript program is entitled to export `open`, and appending an
/// underscore is what it has always cost to say so -- the same rule `div` and
/// `strlen` already live under, reversible by inspection.
const POSIX: &[&str] = &[
    // <unistd.h>
    "access", "alarm", "chdir", "chown", "close", "dup", "dup2", "execl", "execv", "execve",
    "_exit", "fchdir", "fchown", "fork", "fsync", "ftruncate", "getcwd", "getegid", "geteuid",
    "getgid", "getgroups", "gethostname", "getlogin", "getpgid", "getpgrp", "getpid", "getppid",
    "getuid", "isatty", "lchown", "link", "lseek", "pause", "pipe", "pread", "pwrite", "read",
    "readlink", "rmdir", "setgid", "setpgid", "setsid", "setuid", "sleep", "symlink", "sync",
    "truncate", "ttyname", "unlink", "usleep", "write",
    // <fcntl.h> and <sys/stat.h>
    "creat", "fchmod", "fcntl", "fstat", "lstat", "mkdir", "mkfifo", "mknod", "open", "openat",
    "stat", "umask",
    // <sys/socket.h> and <netdb.h>
    "accept", "bind", "connect", "getpeername", "getsockname", "getsockopt", "listen", "recv",
    "recvfrom", "send", "sendto", "setsockopt", "shutdown", "socket", "socketpair",
    // <stdlib.h> and <stdio.h>, the ones a program plausibly exports
    "abort", "atexit", "exit", "getenv", "putenv", "setenv", "unsetenv", "system", "rename",
    "remove", "printf", "fprintf", "sprintf", "snprintf", "puts", "fopen", "fclose", "fread",
    "fwrite", "fseek", "ftell", "rewind", "clearerr", "random", "srandom", "time", "clock",
];

fn collides_with_a_header(name: &str) -> bool {
    if MATH.contains(&name) || TYPES.contains(&name) || STRING.contains(&name) || POSIX.contains(&name)
    {
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

/// The C spelling of a *struct member*, which is a narrower namespace than a
/// linkage name and has one collision of its own.
///
/// Every managed object begins with `NtsHeader header;` -- that is what lets a
/// provider read the descriptor without knowing the type -- so a TypeScript
/// field called `header` is a second member of that name in the same struct.
/// clang says `duplicate member`, and then every `_Static_assert` about the
/// layout fails as well, because `offsetof` no longer names one thing. Ten of
/// `assert`'s errors were that one field, and `assert/src/error.ts` is entitled
/// to it: node's `AssertionError` does not expose the name, so nothing outside
/// can see what it is called.
///
/// The same underscore rule as [`c_identifier`], for the same reason: it is
/// reversible by inspection. It is a separate function rather than an addition
/// to the reserved list because the collision is a member's, not a linker's --
/// a *function* named `header` is fine, and there is no reason to rename it.
#[must_use]
pub fn c_member(name: &str) -> String {
    let spelled = c_identifier(name);
    if spelled == "header" {
        format!("{spelled}_")
    } else {
        spelled
    }
}

/// The C spelling of a module-scope *global*, given the function names the
/// program also emits.
///
/// A third namespace, and the third time this has come up. `c_identifier`
/// answers the linker's question and `c_member` answers a struct's; this one
/// answers C's file scope, where a program's own functions and its own globals
/// share one space that TypeScript keeps apart. `process` declares a function
/// `version()` and a module-scope `const version`, which is ordinary and which
/// C reads as:
///
/// ```text
/// NtsString * version(void);            /* the function */
/// static NtsString * version = 0;       /* the global   */
/// error: redefinition of 'version' as different kind of symbol
/// ```
///
/// Three of them in that module -- `version`, `platform`, `environment` -- and
/// the same underscore rule as the other two, for the same reason: reversible
/// by inspection.
///
/// The *function* keeps the plain name rather than the global, because a
/// function name can be an exported linkage symbol that something outside links
/// against, and a global is reached through the wrapper this compiler generates.
/// Renaming the half that has no external contract is the cheaper half.
#[must_use]
pub fn c_global<'a>(name: &str, mut functions: impl Iterator<Item = &'a str>) -> String {
    let spelled = c_identifier(name);
    if functions.any(|function| c_identifier(function) == spelled) {
        format!("{spelled}_")
    } else {
        spelled
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
///
/// # And there is a third constraint, which is the one that binds
///
/// **`d8` is stricter than the JVM.** DEX's `SimpleName` grammar does not admit
/// `@`, and a class file the JVM loads without complaint is then refused:
///
/// ```text
/// Field name '__@kCount@2' cannot be represented in dex format.
/// ```
///
/// That is `benches/cases/symbol-keys`, whose symbol-keyed property becomes a
/// field with the symbol's identity in its name. It verified, it ran, it agreed
/// with node -- and it could not reach Android, which is the one thing this
/// backend targets that the others do not. Found by dexing all sixty cases;
/// **it is the only one of the sixty**, so `@` is the whole of the difference
/// in practice and not merely the first of a family.
///
/// So the rule is the JVM's *and* DEX's, and the paragraph above is now the
/// reason the two are different rather than the reason to prefer the looser
/// one. Anything DEX forbids that this compiler can emit belongs here.
#[must_use]
pub fn jvm_member_name(raw: &str) -> String {
    raw.chars()
        .map(|ch| match ch {
            // `module#init` becomes `module$init`: `#` is legal in a member
            // name and reads badly in a stack trace, which is the one place a
            // generated name is shown to a person.
            //
            // `@` is not a readability question. `d8` refuses it, so a name
            // carrying one is a program that cannot be shipped to a phone.
            '.' | ';' | '[' | '/' | '<' | '>' | '#' | '@' => '$',
            other => other,
        })
        .collect()
}

/// Whether a member name survives `d8`, in the ASCII range this compiler emits.
///
/// Not a general DEX validator: `SimpleName` admits large unicode ranges and a
/// TypeScript identifier may legitimately use them, so rejecting everything
/// outside `[A-Za-z0-9$_-]` would rename valid programs for no reason. What
/// this checks is that the *mangling* above leaves nothing behind that the
/// format refuses, which is what the test asserts and what the sixty-case sweep
/// found the one exception to.
#[must_use]
pub fn dex_can_spell(name: &str) -> bool {
    !name.is_empty()
        && !name.chars().any(|ch| {
            ch.is_ascii() && !(ch.is_ascii_alphanumeric() || matches!(ch, '$' | '_' | '-'))
        })
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
        // `@` was preserved here until `d8` refused a field carrying one.
        assert_eq!(jvm_member_name("resolve@win32"), "resolve$win32");
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

    /// A name libc also declares is escaped, and the failure it prevents is a
    /// wrong answer rather than a build error.
    ///
    /// `runtime/node/fs` exports `access`. The generated addon emitted
    /// `access(a0, a1)`, a module header pulled `<unistd.h>` in, and the call
    /// bound to POSIX `access(2)` -- an `NtsString *` where a `const char *`
    /// belongs. No refusal, no clang error, the addon links and loads and
    /// returns plausible numbers. The control that settles it is renaming the
    /// export: the same binding as `probeAccess` agrees with node, as `access`
    /// it answers 0 for every input.
    #[test]
    fn a_name_libc_declares_cannot_become_the_emitted_symbol() {
        for name in [
            "access", "open", "read", "write", "close", "link", "unlink", "rename", "stat",
            "truncate", "mkdir", "rmdir", "connect", "listen", "bind", "send", "socket", "exit",
            "time",
        ] {
            assert_eq!(
                c_identifier(name),
                format!("{name}_"),
                "`{name}` is declared by a header this compiler's output includes",
            );
        }
    }

    /// And a name that merely *looks* like one is left alone, because the rule
    /// is about what a linker can confuse rather than about how a name reads.
    #[test]
    fn a_name_no_header_declares_is_left_alone() {
        for name in ["probeAccess", "openFile", "readable", "socketPath", "timestamp"] {
            assert_eq!(c_identifier(name), name);
        }
    }
}
