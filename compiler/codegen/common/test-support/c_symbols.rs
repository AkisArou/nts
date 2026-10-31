//! Observe source function symbols from actual C definitions, without pinning
//! the deterministic private disambiguator in every ABI/body assertion.

pub(crate) fn function_symbol(text: &str, source: &str) -> String {
    source_symbol(text, source)
        .unwrap_or_else(|| panic!("no definition of source function `{source}` in {text}"))
        .to_owned()
}

pub(crate) fn source_symbol<'a>(text: &'a str, source: &str) -> Option<&'a str> {
    let prefix = format!(
        "__nts_fn_{}_",
        nts_codegen_common::symbols::c_private_source(source)
    );
    let source = nts_codegen_common::symbols::c_identifier(source);
    text.lines()
        .filter(|line| !line.starts_with(char::is_whitespace) && line.ends_with('{'))
        .find_map(|line| {
            let (head, _) = line.split_once('(')?;
            let symbol = head
                .rsplit(|c: char| !(c.is_alphanumeric() || c == '_' || c == '$'))
                .find(|part| !part.is_empty())?;
            let private = symbol
                .strip_prefix(&prefix)
                .is_some_and(|id| !id.is_empty() && id.bytes().all(|byte| byte.is_ascii_digit()));
            (symbol == source || private).then_some(symbol)
        })
}
