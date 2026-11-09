//! The reserved core a timed run is measured on: CPU 4, with its sibling 5
//! idle (AGENTS.md, The machine; `tooling/gate/affinity.ts`'s
//! `MEASUREMENT_CPUS`). Gates, landing checks and other sessions run on the
//! other CPUs, where every unit's affinity keeps them, so a run waits for these
//! two and for nothing else; the machine's load and free memory are recorded
//! beside every row instead.
//!
//! The test is `tooling/gate/measurement.ts`'s, the one `with-lock.sh` admits a
//! run by, read from the same counters: a program is user and nice time, and
//! the kernel's own time on the pair -- reclaim, the journal, a disk queue's
//! interrupts -- is not.
use anyhow::{Context, Result, bail, ensure};

/// The measuring CPU and its sibling, in that order.
pub(super) const CPUS: [u32; 2] = [4, 5];

/// More than this share of a one-second look is a program running there
/// (`measurement.ts`'s `PROGRAM_SHARE`): a shell's prompt daemon waking for a
/// few milliseconds is not one.
pub(super) const RUNNING_PERCENT: u64 = 25;

/// Over a longer window, programs' wake-ups may sum to at most this share of
/// it (`measurement.ts`'s `PROGRAM_SHARE_ON_AVERAGE`).
pub(super) const AVERAGE_PERCENT: u64 = 1;

/// One reserved CPU's counters, in clock ticks: all its time, and a program's.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Ticks {
    total: u64,
    program: u64,
}

/// The reserved CPUs' counters from the text of `/proc/stat`, in `CPUS` order.
pub(super) fn parse(stat: &str) -> Result<[Ticks; 2]> {
    let mut found = [None; 2];
    for line in stat.lines() {
        let mut fields = line.split_whitespace();
        let Some(cpu) = fields
            .next()
            .and_then(|name| name.strip_prefix("cpu"))
            .and_then(|number| number.parse::<u32>().ok())
        else {
            continue;
        };
        let Some(slot) = CPUS.iter().position(|reserved| *reserved == cpu) else {
            continue;
        };
        // user nice system idle iowait irq softirq steal: guest time is
        // already inside user and nice.
        let ticks = fields
            .take(8)
            .map(str::parse::<u64>)
            .collect::<Result<Vec<_>, _>>()
            .with_context(|| format!("invalid /proc/stat counters for CPU {cpu}"))?;
        ensure!(
            ticks.len() == 8,
            "invalid /proc/stat counters for CPU {cpu}"
        );
        found[slot] = Some(Ticks {
            total: ticks.iter().sum(),
            program: ticks[0] + ticks[1],
        });
    }
    match found {
        [Some(measuring), Some(sibling)] => Ok([measuring, sibling]),
        _ => bail!("/proc/stat does not name the reserved CPUs 4-5"),
    }
}

/// The reserved CPUs' counters now.
pub(super) fn read() -> Result<[Ticks; 2]> {
    parse(&std::fs::read_to_string("/proc/stat").context("reading /proc/stat")?)
}

/// The first of `cpus` on which a program had more than `percent` of the time
/// between two readings. A counter that did not move or went backwards counts
/// as one: what cannot be read is not known to be quiet.
pub(super) fn program_on(
    before: &[Ticks; 2],
    after: &[Ticks; 2],
    cpus: &[u32],
    percent: u64,
) -> Option<u32> {
    CPUS.iter()
        .zip(before.iter().zip(after))
        .filter(|(cpu, _)| cpus.contains(cpu))
        .find_map(|(cpu, (was, is))| {
            let total = is.total.checked_sub(was.total).filter(|total| *total > 0);
            let program = is.program.checked_sub(was.program);
            match (total, program) {
                (Some(total), Some(program))
                    if program <= total && program * 100 <= total * percent =>
                {
                    None
                }
                _ => Some(*cpu),
            }
        })
}

#[cfg(test)]
mod tests {
    use super::{AVERAGE_PERCENT, CPUS, RUNNING_PERCENT, parse, program_on};

    /// One CPU's `/proc/stat` counters, as (user, nice, system, idle).
    type Counters = (u64, u64, u64, u64);

    /// `/proc/stat` with CPU 0 running flat out -- another session's `nts`, say --
    /// and CPUs 4 and 5 as given: (user, nice, system, idle).
    fn stat(cpu4: Counters, cpu5: Counters) -> String {
        let line = |n: u32, (user, nice, system, idle): Counters| {
            format!("cpu{n} {user} {nice} {system} {idle} 0 0 0 0 0 0")
        };
        [
            "cpu  9000 0 900 9000 0 0 0 0 0 0".to_owned(),
            line(0, (5_000, 0, 100, 0)),
            line(3, (10, 0, 0, 1_000)),
            line(4, cpu4),
            line(5, cpu5),
            line(6, (2_000, 0, 50, 0)),
            "intr 1 2 3".to_owned(),
        ]
        .join("\n")
    }

    /// What `program_on` finds between CPUs 4 and 5 as `before`, then as `after`.
    fn look(
        before: (Counters, Counters),
        after: (Counters, Counters),
        cpus: &[u32],
        percent: u64,
    ) -> Option<u32> {
        let before = parse(&stat(before.0, before.1)).expect("reserved counters");
        let after = parse(&stat(after.0, after.1)).expect("reserved counters");
        program_on(&before, &after, cpus, percent)
    }

    /// An idle reserved CPU, and the same CPU a second later: a hundred ticks, all idle.
    const IDLE: Counters = (10, 0, 5, 1_000);
    const IDLE_LATER: Counters = (10, 0, 5, 1_100);

    #[test]
    fn another_session_on_other_cpus_does_not_disturb_the_reserved_core() {
        let before = parse(&stat(IDLE, IDLE)).expect("counters");
        // CPUs 0 and 6 run flat out between the two readings; 4 and 5 stay idle.
        let busy_elsewhere = stat(IDLE_LATER, IDLE_LATER)
            .replace("cpu0 5000 0 100 0", "cpu0 5100 0 100 0")
            .replace("cpu6 2000 0 50 0", "cpu6 2100 0 50 0");
        let after = parse(&busy_elsewhere).expect("counters");
        assert_eq!(program_on(&before, &after, &CPUS, RUNNING_PERCENT), None);
    }

    #[test]
    fn a_program_on_cpu_5_or_another_on_cpu_4_is_found() {
        assert_eq!(
            look(
                (IDLE, IDLE),
                (IDLE_LATER, (40, 0, 5, 1_070)),
                &CPUS,
                RUNNING_PERCENT
            ),
            Some(5),
            "30 of 100 ticks on the sibling"
        );
        assert_eq!(
            look(
                (IDLE, IDLE),
                ((10, 30, 5, 1_070), IDLE_LATER),
                &CPUS,
                RUNNING_PERCENT
            ),
            Some(4),
            "a niced program counts as one"
        );
        assert_eq!(
            look(
                (IDLE, IDLE),
                ((40, 0, 5, 1_070), IDLE_LATER),
                &[CPUS[1]],
                AVERAGE_PERCENT
            ),
            None,
            "judged on the sibling alone, the measuring CPU's own work is not looked at"
        );
    }

    #[test]
    fn the_kernels_time_and_a_prompts_wakeups_are_not_a_program() {
        assert_eq!(
            look(
                (IDLE, IDLE),
                (IDLE_LATER, (10, 0, 35, 1_070)),
                &CPUS,
                RUNNING_PERCENT
            ),
            None,
            "30 ticks of reclaim and interrupts"
        );
        assert_eq!(
            look(
                (IDLE, IDLE),
                (IDLE_LATER, (12, 0, 5, 1_098)),
                &CPUS,
                RUNNING_PERCENT
            ),
            None,
            "2 ticks of a second"
        );
        assert_eq!(
            look(
                (IDLE, IDLE),
                (IDLE_LATER, (12, 0, 5, 1_098)),
                &CPUS,
                AVERAGE_PERCENT
            ),
            Some(5),
            "over a window, 2% of it is more than wake-ups"
        );
    }

    #[test]
    fn counters_that_cannot_be_read_are_not_known_to_be_quiet() {
        assert_eq!(
            look(
                (IDLE, (20, 0, 5, 1_000)),
                (IDLE_LATER, (10, 0, 5, 1_100)),
                &CPUS,
                RUNNING_PERCENT
            ),
            Some(5),
            "a program counter that went backwards"
        );
        assert_eq!(
            look((IDLE, IDLE), (IDLE, IDLE), &CPUS, RUNNING_PERCENT),
            Some(4),
            "counters that did not move"
        );
        assert!(parse("cpu0 1 2 3 4 5 6 7 8\ncpu5 1 2 3 4 5 6 7 8").is_err());
        assert!(parse("cpu4 1 2 3\ncpu5 1 2 3 4 5 6 7 8").is_err());
    }
}
