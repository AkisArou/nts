//! A forward must-analysis over structured Wasm code.
//!
//! It tracks one flag per local that holds on every path reaching a point.
//! Control is the module's own: the end of a block or an `if` holds what every
//! arriving path holds, an `if` without an `else` counting its entry; a branch
//! arrives at the label it names; and code after an unconditional exit holds
//! everything, which every meet ignores. What one instruction does to the
//! flags is the client's, and so are the two places a path arrives from inside
//! code the driver has not walked yet: a loop's header, entered again from its
//! own body, and a `try_table`'s catches, entered from any instruction of the
//! try. A fact a write only adds keeps all of its entry at both; a fact a
//! write takes away keeps at most what the body never writes.

use crate::ir::{Code, Inst};
use wasm_encoder::Instruction as I;

/// What one analysis makes of the instructions.
pub(crate) trait Flow {
    /// `inst`, at `at` in the code, on a path where `holds` holds before it.
    fn step(&mut self, at: usize, inst: &Inst, holds: &mut [bool]);
    /// A loop's header, entered with `holds`; its body runs from `start` to
    /// its `end` at `end`.
    fn header(&mut self, _start: usize, _end: usize, _holds: &mut [bool]) {}
    /// What a `try_table`'s catches arrive with, from `holds` at its entry: a
    /// throw from anywhere in the try, which runs from `start` to its `end` at
    /// `end`.
    fn caught(&mut self, _start: usize, _end: usize, _holds: &mut [bool]) {}
}

/// Run `flow` over `code` from `initial`, one flag per local.
pub(crate) fn run(code: &Code, initial: Vec<bool>, flow: &mut impl Flow) {
    let ends = matching_ends(code);
    let mut walk = Walk {
        state: Some(initial),
        frames: Vec::new(),
    };
    for (at, inst) in code.insts.iter().enumerate() {
        if let Some(holds) = walk.state.as_mut() {
            flow.step(at, inst, holds);
        }
        if let Inst::Op(I::TryTable(_, catches)) = inst {
            let mut caught = walk.state.clone();
            if let Some(holds) = caught.as_mut() {
                flow.caught(at, ends[at], holds);
            }
            for catch in catches.iter() {
                let (wasm_encoder::Catch::One { label, .. }
                | wasm_encoder::Catch::OneRef { label, .. }
                | wasm_encoder::Catch::All { label }
                | wasm_encoder::Catch::AllRef { label }) = catch;
                walk.arrive(*label, &caught);
            }
        }
        if !walk.control(inst) {
            break;
        }
        if matches!(inst, Inst::Op(I::Loop(_)))
            && let Some(holds) = walk.state.as_mut()
        {
            flow.header(at, ends[at], holds);
        }
    }
}

/// For each structure's opening instruction, the position of its `end`.
pub(crate) fn matching_ends(code: &Code) -> Vec<usize> {
    let mut ends = vec![0; code.insts.len()];
    let mut open = Vec::new();
    for (at, inst) in code.insts.iter().enumerate() {
        match inst {
            Inst::Op(I::Block(_) | I::Loop(_) | I::If(_) | I::TryTable(..)) => open.push(at),
            Inst::Op(I::End) => {
                if let Some(start) = open.pop() {
                    ends[start] = at;
                }
            }
            _ => {}
        }
    }
    ends
}

/// The flags on every path to a point, or `None` where no path is.
type State = Option<Vec<bool>>;

/// `into` narrowed to what `from` also holds; an unreachable side adds no
/// constraint.
fn meet(into: &mut State, from: &State) {
    match (into.as_mut(), from) {
        (_, None) => {}
        (None, Some(from)) => *into = Some(from.clone()),
        (Some(into), Some(from)) => {
            for (holds, also) in into.iter_mut().zip(from) {
                *holds &= *also;
            }
        }
    }
}

/// An open structure: what held at its entry, and what holds where it exits.
struct Frame {
    looping: bool,
    is_if: bool,
    entry: State,
    exit: State,
    has_else: bool,
}

struct Walk {
    state: State,
    frames: Vec<Frame>,
}

impl Walk {
    /// Take one instruction's control; `false` at the function's own end.
    fn control(&mut self, inst: &Inst) -> bool {
        let Inst::Op(i) = inst else {
            if matches!(inst, Inst::Throw(_)) {
                self.state = None;
            }
            return true;
        };
        match i {
            // A `try_table`'s catches arrived in `run`, with what the client
            // says they carry; as a structure it is a block.
            I::Block(_) | I::TryTable(..) => self.open(false, false),
            I::Loop(_) => self.open(true, false),
            I::If(_) => self.open(false, true),
            I::Else => {
                if let Some(frame) = self.frames.last_mut() {
                    meet(&mut frame.exit, &self.state);
                    frame.has_else = true;
                    self.state = frame.entry.clone();
                }
            }
            I::End => return self.close(),
            I::Br(depth) => {
                self.branch(*depth);
                self.state = None;
            }
            I::BrIf(depth) | I::BrOnNull(depth) | I::BrOnNonNull(depth) => self.branch(*depth),
            I::BrOnCast { relative_depth, .. } | I::BrOnCastFail { relative_depth, .. } => {
                self.branch(*relative_depth);
            }
            I::BrTable(targets, default) => {
                for depth in targets.iter().chain(std::iter::once(default)) {
                    self.branch(*depth);
                }
                self.state = None;
            }
            I::Return | I::Unreachable | I::ThrowRef => self.state = None,
            _ => {}
        }
        true
    }

    fn open(&mut self, looping: bool, is_if: bool) {
        self.frames.push(Frame {
            looping,
            is_if,
            entry: self.state.clone(),
            exit: None,
            has_else: false,
        });
    }

    /// The end of a structure, or `false` at the function's own.
    fn close(&mut self) -> bool {
        let Some(mut frame) = self.frames.pop() else {
            return false;
        };
        if !frame.looping {
            meet(&mut frame.exit, &self.state);
            if frame.is_if && !frame.has_else {
                meet(&mut frame.exit, &frame.entry);
            }
            self.state = frame.exit;
        }
        true
    }

    /// A branch to the label `depth` structures out, with what holds here.
    fn branch(&mut self, depth: u32) {
        let here = self.state.clone();
        self.arrive(depth, &here);
    }

    /// `state` arriving at the label `depth` structures out.
    fn arrive(&mut self, depth: u32, state: &State) {
        let Some(at) = self.frames.len().checked_sub(depth as usize + 1) else {
            return; // the function's own label: a return
        };
        let frame = &mut self.frames[at];
        if !frame.looping {
            meet(&mut frame.exit, state);
        }
    }
}
