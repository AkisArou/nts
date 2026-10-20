//! What a C header says a declaration is, asked of clang, for every binder
//! that holds metadata to a header: the parsed C type ([`ctype`]) and the
//! filtered probe that asks for it ([`probe`]).

pub(crate) mod ctype;
pub(crate) mod probe;

/// A macro as the compiled program defines it, before every include:
/// `NAME=VALUE` is `#define NAME VALUE` and a bare `NAME` is `#define NAME 1`,
/// the C emitter's own reading of `@ntsDefine`. A probe that read the headers
/// under any other definition would answer for a different program.
pub(crate) fn define_line(define: &str) -> String {
    match define.split_once('=') {
        Some((name, value)) => format!("#define {name} {value}"),
        None => format!("#define {define} 1"),
    }
}

/// The lines that bring headers in under their macros: each define, then
/// each include, in that order.
pub(crate) fn preamble(defines: &[String], headers: &[String]) -> Vec<String> {
    defines
        .iter()
        .map(|define| define_line(define))
        .chain(headers.iter().map(|header| format!("#include <{header}>")))
        .collect()
}
