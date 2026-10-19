// A module evaluated only for its side effect, for side-effect-import.ts.
((globalThis as { effects?: string[] }).effects ??= []).push("effect");
export {};
