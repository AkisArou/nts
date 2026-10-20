//! What a C header says a declaration is, asked of clang, for every binder
//! that holds metadata to a header: the parsed C type ([`ctype`]) and the
//! filtered probe that asks for it ([`probe`]).

pub(crate) mod ctype;
pub(crate) mod probe;
