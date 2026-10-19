// An exported enum and namespace, for enum-and-namespace-imports.ts.
export enum Level { Low = 1, High = 2 }
export namespace Levels {
  export function label(level: Level): string {
    return Level[level].toLowerCase();
  }
}
