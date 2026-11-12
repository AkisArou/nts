//! The positive-match assertion, included only by tests that require it.

pub(crate) fn function_symbol(text: &str, source: &str) -> String {
    super::c_symbols::source_symbol(text, source)
        .unwrap_or_else(|| panic!("no definition of source function `{source}` in {text}"))
        .to_owned()
}
