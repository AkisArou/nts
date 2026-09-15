// A strict subset of targets. Two platforms, and no desktop fallback on
// purpose: a package that silently degrades is worse than one that refuses,
// because the caller cannot tell which it got.
export interface Prompt {
  authenticate(reason: string): Promise<boolean>;
}

export declare function prompt(): Prompt;
