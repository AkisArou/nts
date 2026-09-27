//! A snapshot cache entry's key must carry which questions were asked of the
//! checker, because the answers are what the snapshot contains.
//!
//! No tsgo and no I/O: the identity is a function of the configuration alone,
//! which is why this can be a unit-cost test of the thing that went wrong.

use nts_frontend_ts::tsgo::decompose::Budget;
use nts_frontend_ts::{SemanticSource, TsgoApi};

/// Three configurations that build different snapshots must not share a key.
///
/// `nts frontend` with no flags asks for none of the passes,
/// [`TsgoApi::for_compilation`] asks for decomposition and call resolution, and
/// `nts frontend --decompose --calls --constants` asks for all three. They shared
/// one cache key until 2026-09-27, and because the cache lives under the temp
/// directory it crossed lanes: a `frontend` run made the next build of the same
/// project compile a **smaller program** -- 16 functions where `examples/math`
/// emits 40 -- with nothing refused and nothing printed.
#[test]
fn the_questions_asked_are_part_of_the_identity() {
    let bare = TsgoApi::new("tsgo").identity();
    let compiling = TsgoApi::for_compilation("tsgo").identity();
    let everything = TsgoApi::new("tsgo")
        .with_decomposition(Budget::DEFAULT)
        .with_call_resolution(Budget::DEFAULT)
        .with_constant_folding(Budget::DEFAULT)
        .identity();
    assert_ne!(bare, compiling, "a build asks more than a bare `nts frontend`");
    assert_ne!(compiling, everything, "constant folding is a different snapshot");
    assert_ne!(bare, everything, "and so is asking for all three");
}

/// A budget belongs in the key because it bounds what decomposition reaches.
///
/// Two runs at different budgets are two different snapshots, so a key that
/// carried only *whether* the pass ran would serve whichever was stored first.
#[test]
fn a_budget_is_part_of_the_identity() {
    let default = TsgoApi::new("tsgo")
        .with_decomposition(Budget::DEFAULT)
        .identity();
    let wider = TsgoApi::new("tsgo")
        .with_decomposition(Budget { per_seed: Budget::DEFAULT.per_seed + 48 })
        .identity();
    assert_ne!(default, wider, "a wider budget reaches further, so it is a different snapshot");
}

/// And two sources asking the same questions still share an entry, which is the
/// whole point of the cache: the key names the question, not the command.
#[test]
fn the_same_questions_give_the_same_identity() {
    assert_eq!(
        TsgoApi::for_compilation("tsgo").identity(),
        TsgoApi::for_compilation("tsgo").identity(),
    );
}
