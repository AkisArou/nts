// rustc's own lexer, without resolving or compiling the submitted source.
// This proc macro receives the file as tokens. A branded diagnostic returns
// the signature to comment-changes.ts; an ordinary compiler error means unknown.
extern crate proc_macro;

use proc_macro::{Delimiter, TokenStream, TokenTree};

fn signature(stream: TokenStream, depth: usize) -> Result<String, ()> {
    if depth > 256 {
        return Err(());
    }
    let tokens: Vec<_> = stream.into_iter().collect();
    let mut result = String::new();
    let mut at = 0;
    while at < tokens.len() {
        let token = &tokens[at];
        // rustc desugars doc comments to attributes, retaining their source
        // span. Explicit #[doc = ...] attributes remain ordinary code.
        if let TokenTree::Punct(p) = token {
            if p.as_char() == '#' {
                let text = p.span().source_text().ok_or(())?;
                if text.starts_with("///")
                    || text.starts_with("//!")
                    || text.starts_with("/**")
                    || text.starts_with("/*!")
                {
                    at += 1;
                    if matches!(tokens.get(at), Some(TokenTree::Punct(p)) if p.as_char() == '!') {
                        at += 1;
                    }
                    match tokens.get(at) {
                        Some(TokenTree::Group(g))
                            if g.delimiter() == Delimiter::Bracket
                                && g.stream().to_string().starts_with("doc =") => {}
                        _ => return Err(()),
                    }
                    at += 1;
                    continue;
                }
            }
        }
        match token {
            TokenTree::Group(g) => {
                result.push_str(&format!(
                    "G{:?}[{}]",
                    g.delimiter(),
                    signature(g.stream(), depth + 1)?
                ));
            }
            TokenTree::Ident(i) => result.push_str(&format!("I{:?};", i.to_string())),
            TokenTree::Literal(l) => result.push_str(&format!("L{:?};", l.to_string())),
            TokenTree::Punct(p) => result.push_str(&format!("P{}{:?};", p.as_char(), p.spacing())),
        }
        at += 1;
    }
    Ok(result)
}

#[proc_macro]
pub fn comment_signature(input: TokenStream) -> TokenStream {
    let result = signature(input, 0).unwrap_or_else(|()| "unknown".into());
    format!(
        "compile_error!({:?});",
        format!("nts-comment-tokens-v1:{result}")
    )
    .parse()
    .unwrap()
}
