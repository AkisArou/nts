//! C types as the headers spell them, parsed from clang's AST and resolved
//! through the typedef chain to what the compiler finally sees.
//!
//! **Why the headers and not the metadata.** Win32 metadata records `INT` and
//! `LONG` both as `I32`, and on Windows those are two C types, `int` and
//! `long`, which the witness tells apart exactly. The metadata says what a
//! parameter *means* -- optional, a UTF-16 string, a handle -- and the header
//! says what it *is*.

use std::collections::BTreeMap;

use anyhow::{Result, bail};

/// A C type, fully resolved: no typedef names remain.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CType {
    Void,
    /// A scalar by its canonical C spelling: `unsigned long`, `long long`.
    Scalar(String),
    Pointer { to: Box<CType>, constant: bool },
    /// `struct tag` or `union tag`; `tag` is what `struct` names.
    Record { union: bool, tag: String },
    Enum(String),
    Array(Box<CType>, u64),
    Function { result: Box<CType>, parameters: Vec<CType>, variadic: bool },
}

impl CType {
    /// The C spelling of this type as an abstract declarator's base, for a
    /// check file: `struct HWND__ *`, `unsigned long`.
    pub(crate) fn spelled(&self) -> String {
        match self {
            Self::Void => "void".to_owned(),
            Self::Scalar(name) => name.clone(),
            Self::Pointer { to, constant } => match &**to {
                Self::Function { result, parameters, variadic } => {
                    format!("{} (*)({})", result.spelled(), parameter_list(parameters, *variadic))
                }
                inner => format!("{}{} *", if *constant { "const " } else { "" }, inner.spelled()),
            },
            Self::Record { union, tag } => format!("{} {tag}", if *union { "union" } else { "struct" }),
            Self::Enum(tag) => format!("enum {tag}"),
            Self::Array(inner, _) => format!("{} *", inner.spelled()),
            Self::Function { result, parameters, variadic } => {
                format!("{} ({})", result.spelled(), parameter_list(parameters, *variadic))
            }
        }
    }
}

pub(crate) fn parameter_list(parameters: &[CType], variadic: bool) -> String {
    let mut list: Vec<String> = parameters.iter().map(CType::spelled).collect();
    if variadic {
        list.push("...".to_owned());
    }
    if list.is_empty() { "void".to_owned() } else { list.join(", ") }
}

/// The C scalar spellings clang prints, canonicalised: `short` and
/// `short int` are one type.
fn scalar(words: &str) -> Option<&'static str> {
    Some(match words {
        "char" => "char",
        "signed char" => "signed char",
        "unsigned char" => "unsigned char",
        "short" | "short int" | "signed short" => "short",
        "unsigned short" | "unsigned short int" | "short unsigned int" => "unsigned short",
        "int" | "signed int" | "signed" => "int",
        "unsigned int" | "unsigned" => "unsigned int",
        "long" | "long int" | "signed long" => "long",
        "unsigned long" | "unsigned long int" | "long unsigned int" => "unsigned long",
        "long long" | "long long int" | "signed long long" | "__int64" => "long long",
        "unsigned long long" | "unsigned long long int" | "long long unsigned int" | "unsigned __int64" => {
            "unsigned long long"
        }
        "float" => "float",
        "double" => "double",
        "_Bool" | "bool" => "_Bool",
        _ => return None,
    })
}

/// Everything clang may append that is not part of the type's identity.
fn strip_attributes(spelling: &str) -> String {
    let mut out = String::new();
    let mut rest = spelling;
    while let Some(at) = rest.find("__attribute__((") {
        out.push_str(&rest[..at]);
        let after = &rest[at + "__attribute__".len()..];
        let mut depth = 0i32;
        let mut end = after.len();
        for (index, ch) in after.char_indices() {
            match ch {
                '(' => depth += 1,
                ')' => {
                    depth -= 1;
                    if depth == 0 {
                        end = index + 1;
                        break;
                    }
                }
                _ => {}
            }
        }
        rest = &after[end..];
    }
    out.push_str(rest);
    out.replace("__unaligned", " ").replace("restrict", " ").replace("volatile", " ")
}

/// Split a parameter list on its top-level commas.
fn split_top(list: &str) -> Vec<String> {
    let (mut out, mut depth, mut current) = (Vec::new(), 0i32, String::new());
    for ch in list.chars() {
        match ch {
            '(' | '[' => {
                depth += 1;
                current.push(ch);
            }
            ')' | ']' => {
                depth -= 1;
                current.push(ch);
            }
            ',' if depth == 0 => out.push(std::mem::take(&mut current)),
            _ => current.push(ch),
        }
    }
    if !current.trim().is_empty() {
        out.push(current);
    }
    out.into_iter().map(|one| one.trim().to_owned()).collect()
}

/// The index of the `(` that opens the outermost trailing parameter list.
fn trailing_parameters(spelling: &str) -> Option<usize> {
    if !spelling.ends_with(')') {
        return None;
    }
    let mut depth = 0i32;
    for (index, ch) in spelling.char_indices().rev() {
        match ch {
            ')' => depth += 1,
            '(' => {
                depth -= 1;
                if depth == 0 {
                    return Some(index);
                }
            }
            _ => {}
        }
    }
    None
}

/// Parse one spelling, leaving typedef names for `resolve` to look up.
pub(crate) fn parse(spelling: &str, typedefs: &BTreeMap<String, String>) -> Result<CType> {
    parse_depth(&strip_attributes(spelling), typedefs, 0)
}

fn parse_depth(spelling: &str, typedefs: &BTreeMap<String, String>, depth: u32) -> Result<CType> {
    if depth > 32 {
        bail!("`{spelling}` did not resolve within 32 typedefs");
    }
    let spelling = spelling.split_whitespace().collect::<Vec<_>>().join(" ");
    let spelling = spelling.trim();
    // `R (*)(A, B)` and `R (A, B)`: the trailing list is the parameters.
    if let Some(open) = trailing_parameters(spelling) {
        let head = spelling[..open].trim();
        let parameters_text = &spelling[open + 1..spelling.len() - 1];
        let (result_text, pointer) = match head.strip_suffix("(*)") {
            Some(result) => (result.trim(), true),
            None => (head, false),
        };
        // `T (*)[N]`-like shapes are not functions; only a real result head is.
        if !result_text.is_empty() {
            let mut parameters = Vec::new();
            let mut variadic = false;
            for one in split_top(parameters_text) {
                if one == "..." {
                    variadic = true;
                } else if one != "void" && !one.is_empty() {
                    parameters.push(parse_depth(&one, typedefs, depth)?);
                }
            }
            let function = CType::Function {
                result: Box::new(parse_depth(result_text, typedefs, depth)?),
                parameters,
                variadic,
            };
            return Ok(if pointer { CType::Pointer { to: Box::new(function), constant: false } } else { function });
        }
    }
    // `T [N]`.
    if let Some(inner) = spelling.strip_suffix(']')
        && let Some((element, count)) = inner.rsplit_once('[')
    {
        let count: u64 = count.trim().parse().map_err(|_| anyhow::anyhow!("`{spelling}` has no constant length"))?;
        return Ok(CType::Array(Box::new(parse_depth(element, typedefs, depth)?), count));
    }
    // `T *` and `T *const`: a const on the pointer itself changes nothing here.
    let unqualified_pointer = spelling.strip_suffix("const").map(str::trim).filter(|s| s.ends_with('*'));
    if let Some(inner) = unqualified_pointer.or(Some(spelling)).and_then(|s| s.strip_suffix('*')) {
        let inner = inner.trim();
        let (inner, constant) = match inner.strip_prefix("const ") {
            Some(rest) => (rest.trim(), true),
            None => match inner.strip_suffix(" const") {
                Some(rest) => (rest.trim(), true),
                None => (inner, false),
            },
        };
        return Ok(CType::Pointer { to: Box::new(parse_depth(inner, typedefs, depth)?), constant });
    }
    let bare = spelling.strip_prefix("const ").unwrap_or(spelling).trim();
    let bare = bare.strip_suffix(" const").unwrap_or(bare).trim();
    if bare == "void" {
        return Ok(CType::Void);
    }
    for (keyword, union) in [("struct ", false), ("union ", true)] {
        if let Some(tag) = bare.strip_prefix(keyword) {
            return Ok(CType::Record { union, tag: tag.trim().to_owned() });
        }
    }
    if let Some(tag) = bare.strip_prefix("enum ") {
        return Ok(CType::Enum(tag.trim().to_owned()));
    }
    if let Some(name) = scalar(bare) {
        return Ok(CType::Scalar(name.to_owned()));
    }
    match typedefs.get(bare) {
        Some(next) if next != bare => parse_depth(&strip_attributes(next), typedefs, depth + 1),
        Some(_) => bail!("`{bare}` is a typedef of itself"),
        None => bail!("`{bare}` is a typedef the headers were not asked about"),
    }
}

/// Every identifier in a spelling that is not a C keyword or scalar word:
/// the typedef names it still needs.
pub(crate) fn typedef_names(spelling: &str) -> Vec<String> {
    const WORDS: &[&str] = &[
        "const", "volatile", "restrict", "struct", "union", "enum", "void", "char", "short", "int", "long",
        "signed", "unsigned", "float", "double", "_Bool", "bool", "__int64", "__unaligned",
    ];
    let text = strip_attributes(spelling);
    let mut names = Vec::new();
    let mut previous_keyword = "";
    for word in text.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_')).filter(|w| !w.is_empty()) {
        let is_tag = matches!(previous_keyword, "struct" | "union" | "enum");
        previous_keyword = word;
        if is_tag || WORDS.contains(&word) || word.chars().next().is_some_and(|c| c.is_ascii_digit()) {
            continue;
        }
        names.push(word.to_owned());
    }
    names
}
