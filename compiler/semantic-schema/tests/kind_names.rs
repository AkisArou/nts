//! Every named kind agrees with the constants read off a real program.
//!
//! `syntax.rs` holds two things about a `SyntaxKind`: the constants the lowering
//! matches on, read off an encoded program and pinned by a fixture, and the
//! names `name_of` reports in a diagnostic, transcribed from tsgo's `iota` list.
//! The second is allowed to be transcribed because a wrong *name* misspells a
//! message while a wrong *constant* mis-identifies a node -- but only if
//! something notices when the two disagree.
//!
//! This is that something, and it earned its place immediately: the first
//! transcription was off by one, because two entries in the Go list carry
//! trailing comments and the parse skipped them. Every name after the first of
//! those was shifted, so `216` read as a type assertion when it is a tagged
//! template. A refusal naming the wrong construct is worse than the number it
//! replaced.

use nts_semantic_schema::syntax;

/// The constant's own name, as the table would spell it.
fn spelled(constant: &str) -> String {
    constant
        .split('_')
        .map(str::to_lowercase)
        .collect::<Vec<_>>()
        .join(" ")
}

#[test]
fn every_constant_agrees_with_its_name() {
    let source = include_str!("../src/syntax.rs");
    let mut checked = 0;
    let mut disagreed = Vec::new();
    for line in source.lines() {
        let Some(rest) = line.strip_prefix("pub const ") else {
            continue;
        };
        let Some((name, value)) = rest.split_once(": u16 = ") else {
            continue;
        };
        let Ok(kind) = value.trim_end_matches(';').parse::<u16>() else {
            continue;
        };
        let Some(named) = syntax::name_of(kind) else {
            panic!("kind {kind} (`{name}`) has no name in the table");
        };
        // One is allowed to be the other's prefix: the constants say
        // `END_OF_FILE_TOKEN` where tsgo says `EndOfFile`, and a suffix like
        // `token` or `keyword` is a naming habit rather than a different node.
        // A number that has *shifted* names an adjacent kind, whose name shares
        // no prefix at all, so this still catches the failure it exists for.
        // Compared without word boundaries, because the two disagree about
        // where words end: `BIGINT_LITERAL` against tsgo's `BigIntLiteral`,
        // `INSTANCEOF_KEYWORD` against `InstanceOfKeyword`. Where a *number*
        // has shifted the name is a different word entirely, so this still
        // catches what it exists for -- it caught `instanceof` sitting on
        // `new`'s number.
        let ours = spelled(name).replace(' ', "");
        let theirs = named.replace(' ', "");
        if !ours.starts_with(&theirs) && !theirs.starts_with(&ours) {
            disagreed.push(format!("{kind}: constant `{name}`, table `{named}`"));
        }
        checked += 1;
    }
    assert!(
        disagreed.is_empty(),
        "the transcription has drifted from the constants:\n  {}",
        disagreed.join("\n  ")
    );
    assert!(
        checked > 100,
        "only {checked} constants checked; the parse is wrong"
    );
}
