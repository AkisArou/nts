//! Native fields projected onto the child layout the snapshot owns.

use nts_frontend_tsrs::{ChildRole, ListRole};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Projection {
    Slot(&'static str),
    ListContents,
    NotSlot(&'static str),
}

include!("../native_roles.rs");

macro_rules! child_projection {
    ($($name:ident => $projection:ident $(($detail:literal))?,)*) => {
        pub(crate) fn child(role: ChildRole) -> Projection {
            match role { $(ChildRole::$name => Projection::$projection $(($detail))?,)* }
        }
    };
}
macro_rules! list_projection {
    ($($name:ident => $projection:ident $(($detail:literal))?,)*) => {
        pub(crate) fn list(role: ListRole) -> Projection {
            match role { $(ListRole::$name => Projection::$projection $(($detail))?,)* }
        }
    };
}

native_child_roles!(child_projection);
native_list_roles!(list_projection);
