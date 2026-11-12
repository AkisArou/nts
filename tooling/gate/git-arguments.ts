// Optional index refreshes belong to the tree's writer, never an observer.
// Required locks for add, commit and other mutations remain enabled.
export const GIT_NO_OPTIONAL_LOCKS='--no-optional-locks';
export function gitArguments(argv:readonly string[]):string[]{
  return argv[0]===GIT_NO_OPTIONAL_LOCKS?[...argv]:[GIT_NO_OPTIONAL_LOCKS,...argv];
}
