/** @ntsClass NativeBase */
declare class NativeBase {
  /** @ntsSelector actualGo */
  go(): void;
  /** @ntsSelector actualLabel */
  get label(): string;
}

// Only ancestry depth differs between the control and subject.
declare class Short0 extends NativeBase {}
declare class Short1 extends Short0 {}
declare class Short2 extends Short1 {}
declare class Short3 extends Short2 {}
declare class Short4 extends Short3 {}
declare class Short5 extends Short4 {}
declare class Short6 extends Short5 {}
declare class Short7 extends Short6 {}
declare class Control extends Short7 {
  override go(): void;
  override get label(): string;
}

declare class Deep0 extends NativeBase {}
declare class Deep1 extends Deep0 {}
declare class Deep2 extends Deep1 {}
declare class Deep3 extends Deep2 {}
declare class Deep4 extends Deep3 {}
declare class Deep5 extends Deep4 {}
declare class Deep6 extends Deep5 {}
declare class Deep7 extends Deep6 {}
declare class Deep8 extends Deep7 {}
declare class Deep9 extends Deep8 {}
declare class Deep10 extends Deep9 {}
declare class Deep11 extends Deep10 {}
declare class Deep12 extends Deep11 {}
declare class Deep13 extends Deep12 {}
declare class Deep14 extends Deep13 {}
declare class Deep15 extends Deep14 {}
declare class Deep16 extends Deep15 {}
declare class Deep17 extends Deep16 {}
declare class Deep18 extends Deep17 {}
declare class Deep19 extends Deep18 {}
declare class Deep20 extends Deep19 {}
declare class Deep21 extends Deep20 {}
declare class Deep22 extends Deep21 {}
declare class Deep23 extends Deep22 {}
declare class Deep24 extends Deep23 {}
declare class Deep25 extends Deep24 {}
declare class Deep26 extends Deep25 {}
declare class Deep27 extends Deep26 {}
declare class Deep28 extends Deep27 {}
declare class Deep29 extends Deep28 {}
declare class Deep30 extends Deep29 {}
declare class Deep31 extends Deep30 {}
declare class Deep32 extends Deep31 {}
declare class Deep33 extends Deep32 {}
declare class Deep34 extends Deep33 {}
declare class Deep35 extends Deep34 {}
declare class Deep36 extends Deep35 {}
declare class Deep37 extends Deep36 {}
declare class Deep38 extends Deep37 {}
declare class Deep39 extends Deep38 {}
declare class Deep40 extends Deep39 {}
declare class Deep41 extends Deep40 {}
declare class Deep42 extends Deep41 {}
declare class Deep43 extends Deep42 {}
declare class Deep44 extends Deep43 {}
declare class Deep45 extends Deep44 {}
declare class Deep46 extends Deep45 {}
declare class Deep47 extends Deep46 {}
declare class Deep48 extends Deep47 {}
declare class Deep49 extends Deep48 {}
declare class Deep50 extends Deep49 {}
declare class Deep51 extends Deep50 {}
declare class Deep52 extends Deep51 {}
declare class Deep53 extends Deep52 {}
declare class Deep54 extends Deep53 {}
declare class Deep55 extends Deep54 {}
declare class Deep56 extends Deep55 {}
declare class Deep57 extends Deep56 {}
declare class Deep58 extends Deep57 {}
declare class Deep59 extends Deep58 {}
declare class Deep60 extends Deep59 {}
declare class Deep61 extends Deep60 {}
declare class Deep62 extends Deep61 {}
declare class Deep63 extends Deep62 {}
declare class Deep64 extends Deep63 {}
declare class Deep65 extends Deep64 {}
declare class Deep66 extends Deep65 {}
declare class Deep67 extends Deep66 {}
declare class Deep68 extends Deep67 {}
declare class Deep69 extends Deep68 {}
declare class Deep70 extends Deep69 {}
declare class Deep71 extends Deep70 {}
declare class Deep72 extends Deep71 {}
declare class Deep73 extends Deep72 {}
declare class Deep74 extends Deep73 {}
declare class Deep75 extends Deep74 {}
declare class Deep76 extends Deep75 {}
declare class Deep77 extends Deep76 {}
declare class Deep78 extends Deep77 {}
declare class Deep79 extends Deep78 {}
declare class Subject extends Deep79 {
  override go(): void;
  override get label(): string;
}

interface Signals { readonly __c_signals?: { changed: [number] }; }
export function signalOwner<T0 extends Signals, T1 extends T0, T2 extends T1, T3 extends T2, T4 extends T3, T5 extends T4, T6 extends T5, T7 extends T6, T8 extends T7, T9 extends T8, T10 extends T9, T11 extends T10, T12 extends T11, T13 extends T12, T14 extends T13, T15 extends T14, T16 extends T15, T17 extends T16, T18 extends T17, T19 extends T18, T20 extends T19, T21 extends T20, T22 extends T21, T23 extends T22, T24 extends T23, T25 extends T24, T26 extends T25, T27 extends T26, T28 extends T27, T29 extends T28, T30 extends T29, T31 extends T30, T32 extends T31>(value: T32): T32 { return value; }
