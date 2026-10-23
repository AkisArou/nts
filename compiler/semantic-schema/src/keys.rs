//! Standard symbol identities, independent of checker names and counters.

use serde::{Deserialize, Serialize};

/// ECMAScript's closed set of well-known symbols. The frontend records only
/// identities reachable in the requested program.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum WellKnownSymbol {
    AsyncIterator,
    HasInstance,
    IsConcatSpreadable,
    Iterator,
    Match,
    MatchAll,
    Replace,
    Search,
    Species,
    Split,
    ToPrimitive,
    ToStringTag,
    Unscopables,
    Dispose,
    AsyncDispose,
}
