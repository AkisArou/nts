use std::cell::Cell;

#[derive(Clone, Copy, Debug)]
pub(super) enum Counter {
    Block,
    FreshOperation,
    Operation,
    Parameter,
    Argument,
    Store,
    Value,
    Operand,
    RetainOperation,
    RetainParameter,
    RenumberParameter,
    RetainArgument,
}

thread_local! {
    static WORK: Cell<[u64; 12]> = const { Cell::new([0; 12]) };
}

pub(super) fn note(counter: Counter) {
    WORK.with(|work| {
        let mut counts = work.get();
        counts[counter as usize] += 1;
        work.set(counts);
    });
}

pub(super) fn reset() {
    WORK.with(|work| work.set([0; 12]));
}
pub(super) fn take() -> [u64; 12] {
    WORK.with(|work| work.replace([0; 12]))
}
