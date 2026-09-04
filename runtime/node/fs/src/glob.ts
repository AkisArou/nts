// `fs.glob` traversal, from node v24.20.0 `lib/internal/fs/glob.js`.
//
// Pattern compilation lives in `node:path`, which is the other public API
// backed by Node's minimatch. The traversal here follows Node's queue and
// pattern-index algorithm: it prunes literal prefixes, tracks symlink visits
// per pattern state, and detects realpath cycles only when following links.

import {
  basename as basenamePath,
  dirname as dirnamePath,
  isAbsolute as isAbsolutePath,
  join as joinPath,
  resolve as resolvePath,
} from "../../path/src/posix.ts";
import {
  CompiledGlobPattern,
  GlobSegmentMatcher,
  GlobStar,
  compileGlobPatterns,
  matchesCompiledGlobPatterns,
  type GlobPart,
} from "../../path/src/glob-matcher.ts";
import {
  validateBoolean,
  validateObject,
  validateString,
} from "../../internal/validators.ts";
import { ERR_INVALID_ARG_TYPE } from "../../internal/errors.ts";
import { getValidatedPath, type PathLike } from "./options.ts";
import { Dirent, Stats } from "./stats.ts";

export type GlobPatternInput = string | string[];
export type GlobExclude = string[] | ((value: string | Dirent) => boolean);

export interface GlobOptions {
  cwd?: PathLike | undefined;
  exclude?: GlobExclude | undefined;
  withFileTypes?: boolean | undefined;
  followSymlinks?: boolean | undefined;
}

interface RawGlobOptions {
  readonly cwd?: unknown;
  readonly exclude?: unknown;
  readonly withFileTypes?: unknown;
  readonly followSymlinks?: unknown;
}

function validateGlobOptionsObject(value: unknown): asserts value is RawGlobOptions {
  validateObject(value, "options");
}

function validateGlobExcludeFunction(
  value: unknown,
): asserts value is (item: string | Dirent) => boolean {
  if (typeof value !== "function") {
    throw new ERR_INVALID_ARG_TYPE("options.exclude", "function", value);
  }
}

export interface NormalizedGlobOptions {
  readonly cwd: string;
  readonly exclude: GlobExclude | undefined;
  readonly withFileTypes: boolean;
  readonly followSymlinks: boolean;
}

export interface SyncGlobFileSystem {
  lstat(path: string): Dirent | null;
  stat(path: string): Stats | null;
  readdir(path: string): Dirent[];
  realpath(path: string): string | null;
}

export interface AsyncGlobFileSystem {
  lstat(path: string): Promise<Dirent | null>;
  stat(path: string): Promise<Stats | null>;
  readdir(path: string): Promise<Dirent[]>;
  realpath(path: string): Promise<string | null>;
}

function validateStringList(value: unknown, name: string): asserts value is string[] {
  if (!Array.isArray(value)) throw new ERR_INVALID_ARG_TYPE(name, "string[]", value);
  for (let index = 0; index < value.length; index++) {
    validateString(value[index], `${name}[${index}]`);
  }
}

function validatePatternInput(value: unknown): asserts value is GlobPatternInput {
  if (Array.isArray(value)) {
    validateStringList(value, "patterns");
  } else {
    validateString(value, "patterns");
  }
}

export function normalizeGlobOptions(
  pattern: unknown,
  value: unknown,
): { patterns: string[]; options: NormalizedGlobOptions } {
  const raw = value === undefined ? {} : value;
  validateGlobOptionsObject(raw);
  const options = raw;

  let cwd = ".";
  if (options.cwd !== undefined) cwd = getValidatedPath(options.cwd, "options.cwd");

  let followSymlinks = false;
  if (options.followSymlinks !== null && options.followSymlinks !== undefined) {
    validateBoolean(options.followSymlinks, "options.followSymlinks");
    followSymlinks = options.followSymlinks;
  }

  let exclude: GlobExclude | undefined;
  if (options.exclude !== null && options.exclude !== undefined) {
    if (Array.isArray(options.exclude)) {
      validateStringList(options.exclude, "options.exclude");
      exclude = options.exclude;
    } else if (typeof options.exclude === "function") {
      validateGlobExcludeFunction(options.exclude);
      exclude = options.exclude;
    } else {
      throw new ERR_INVALID_ARG_TYPE(
        "options.exclude",
        ["string[]", "function"],
        options.exclude,
      );
    }
  }

  validatePatternInput(pattern);
  const patterns = typeof pattern === "string" ? [pattern] : pattern;
  return {
    patterns,
    options: {
      cwd,
      exclude,
      withFileTypes: Boolean(options.withFileTypes),
      followSymlinks,
    },
  };
}

function copyStringSet(source: Set<string>): Set<string> {
  const copy = new Set<string>();
  for (const value of source) copy.add(value);
  return copy;
}

function firstNumber(source: Set<number>): number | undefined {
  for (const value of source) return value;
  return undefined;
}

class TraversalPattern {
  readonly compiled: CompiledGlobPattern;
  readonly indexes: Set<number>;
  readonly symlinks: Set<number>;
  readonly realpaths: Set<string>;
  readonly last: number;

  constructor(
    compiled: CompiledGlobPattern,
    indexes: Set<number>,
    symlinks: Set<number>,
    realpaths = new Set<string>(),
  ) {
    this.compiled = compiled;
    this.indexes = indexes;
    this.symlinks = symlinks;
    this.realpaths = realpaths;
    this.last = compiled.parts.length - 1;
  }

  at(index: number): GlobPart | undefined {
    const actual = index < 0 ? this.compiled.parts.length + index : index;
    return this.compiled.parts[actual];
  }

  isLast(isDirectory: boolean): boolean {
    return this.indexes.has(this.last) ||
      (this.at(-1) === "" && isDirectory && this.indexes.has(this.last - 1) &&
       this.at(-2) instanceof GlobStar);
  }

  isFirst(): boolean {
    return this.indexes.has(0);
  }

  hasSeenSymlinks(): boolean {
    for (const index of this.indexes) {
      if (!this.symlinks.has(index)) return true;
    }
    return false;
  }

  test(index: number, value: string): boolean {
    const part = this.at(index);
    if (part instanceof GlobStar) return true;
    if (typeof part === "string") return part === value;
    if (part instanceof GlobSegmentMatcher) return part.test(value);
    return false;
  }

  child(
    indexes: Set<number>,
    symlinks = new Set<number>(),
    realpaths = this.realpaths,
  ): TraversalPattern {
    return new TraversalPattern(this.compiled, indexes, symlinks, realpaths);
  }

  cacheKey(index: number): string {
    let key = "";
    for (let current = index; current < this.compiled.sourceParts.length; current++) {
      const part = this.compiled.sourceParts[current];
      if (part === undefined) throw new Error(`glob is missing component ${current}`);
      if (current !== index) key += "/";
      key += part;
    }
    return key;
  }
}

class SyncGlobCache {
  readonly fileSystem: SyncGlobFileSystem;
  readonly states = new Map<string, Set<string>>();
  readonly stats = new Map<string, Dirent | null>();
  readonly followedStats = new Map<string, Stats | null>();
  readonly directories = new Map<string, Dirent[]>();
  readonly realpaths = new Map<string, string | null>();

  constructor(fileSystem: SyncGlobFileSystem) {
    this.fileSystem = fileSystem;
  }

  lstat(path: string): Dirent | null {
    const known = this.stats.get(path);
    if (known !== undefined || this.stats.has(path)) return known ?? null;
    const value = this.fileSystem.lstat(path);
    this.stats.set(path, value);
    return value;
  }

  followStat(path: string): Stats | null {
    const known = this.followedStats.get(path);
    if (known !== undefined || this.followedStats.has(path)) return known ?? null;
    const value = this.fileSystem.stat(path);
    this.followedStats.set(path, value);
    return value;
  }

  readdir(path: string): Dirent[] {
    const known = this.directories.get(path);
    if (known !== undefined) return known;
    const value = this.fileSystem.readdir(path);
    this.directories.set(path, value);
    return value;
  }

  realpath(path: string): string | null {
    const known = this.realpaths.get(path);
    if (known !== undefined || this.realpaths.has(path)) return known ?? null;
    const value = this.fileSystem.realpath(path);
    this.realpaths.set(path, value);
    return value;
  }

  addStat(path: string, value: Dirent): void {
    this.stats.set(path, value);
  }

  /** Return true when any of this pattern's states was already present. */
  add(path: string, pattern: TraversalPattern): boolean {
    let states = this.states.get(path);
    if (states === undefined) {
      states = new Set<string>();
      this.states.set(path, states);
    }
    const originalSize = states.size;
    for (const index of pattern.indexes) states.add(pattern.cacheKey(index));
    return states.size !== originalSize + pattern.indexes.size;
  }

  seen(path: string, pattern: TraversalPattern, index: number): boolean {
    return this.states.get(path)?.has(pattern.cacheKey(index)) === true;
  }
}

class AsyncGlobCache {
  readonly fileSystem: AsyncGlobFileSystem;
  readonly states = new Map<string, Set<string>>();
  readonly stats = new Map<string, Promise<Dirent | null>>();
  readonly followedStats = new Map<string, Promise<Stats | null>>();
  readonly directories = new Map<string, Promise<Dirent[]>>();
  readonly realpaths = new Map<string, Promise<string | null>>();

  constructor(fileSystem: AsyncGlobFileSystem) {
    this.fileSystem = fileSystem;
  }

  lstat(path: string): Promise<Dirent | null> {
    let known = this.stats.get(path);
    if (known === undefined) {
      known = this.fileSystem.lstat(path);
      this.stats.set(path, known);
    }
    return known;
  }

  followStat(path: string): Promise<Stats | null> {
    let known = this.followedStats.get(path);
    if (known === undefined) {
      known = this.fileSystem.stat(path);
      this.followedStats.set(path, known);
    }
    return known;
  }

  readdir(path: string): Promise<Dirent[]> {
    let known = this.directories.get(path);
    if (known === undefined) {
      known = this.fileSystem.readdir(path);
      this.directories.set(path, known);
    }
    return known;
  }

  realpath(path: string): Promise<string | null> {
    let known = this.realpaths.get(path);
    if (known === undefined) {
      known = this.fileSystem.realpath(path);
      this.realpaths.set(path, known);
    }
    return known;
  }

  addStat(path: string, value: Dirent): void {
    this.stats.set(path, Promise.resolve(value));
  }

  add(path: string, pattern: TraversalPattern): boolean {
    let states = this.states.get(path);
    if (states === undefined) {
      states = new Set<string>();
      this.states.set(path, states);
    }
    const originalSize = states.size;
    for (const index of pattern.indexes) states.add(pattern.cacheKey(index));
    return states.size !== originalSize + pattern.indexes.size;
  }

  seen(path: string, pattern: TraversalPattern, index: number): boolean {
    return this.states.get(path)?.has(pattern.cacheKey(index)) === true;
  }
}

class GlobResults {
  readonly root: string;
  readonly isExcluded: (absolutePath: string) => boolean;
  readonly values: string[] = [];
  readonly seen = new Set<string>();

  constructor(root: string, isExcluded: (absolutePath: string) => boolean) {
    this.root = root;
    this.isExcluded = isExcluded;
  }

  add(value: string): boolean {
    if (this.isExcluded(resolvePath(this.root, value)) || this.seen.has(value)) return false;
    this.seen.add(value);
    this.values.push(value);
    return true;
  }
}

interface QueueItem {
  readonly path: string;
  readonly patterns: TraversalPattern[];
}

function compileTraversalPatterns(patterns: string[]): TraversalPattern[] {
  const result: TraversalPattern[] = [];
  for (let patternIndex = 0; patternIndex < patterns.length; patternIndex++) {
    const pattern = patterns[patternIndex];
    if (pattern === undefined) throw new Error(`glob is missing pattern ${patternIndex}`);
    const alternatives = compileGlobPatterns(pattern, false);
    for (let alternativeIndex = 0; alternativeIndex < alternatives.length; alternativeIndex++) {
      const alternative = alternatives[alternativeIndex];
      if (alternative === undefined) {
        throw new Error(`glob is missing alternative ${alternativeIndex}`);
      }
      result.push(new TraversalPattern(
        alternative,
        new Set<number>([0]),
        new Set<number>(),
      ));
    }
  }
  return result;
}

function compileStringExclusions(root: string, patterns: string[]): CompiledGlobPattern[] {
  const result: CompiledGlobPattern[] = [];
  for (let index = 0; index < patterns.length; index++) {
    const pattern = patterns[index];
    if (pattern === undefined) throw new Error(`glob exclusion is missing pattern ${index}`);
    const alternatives = compileGlobPatterns(resolvePath(root, pattern), false);
    for (let alternativeIndex = 0; alternativeIndex < alternatives.length; alternativeIndex++) {
      const alternative = alternatives[alternativeIndex];
      if (alternative !== undefined) result.push(alternative);
    }
  }
  return result;
}

class SyncGlobWalker {
  readonly root: string;
  readonly withFileTypes: boolean;
  readonly followSymlinks: boolean;
  readonly callbackExclude: ((value: string | Dirent) => boolean) | undefined;
  readonly cache: SyncGlobCache;
  readonly results: GlobResults;
  readonly patterns: TraversalPattern[];
  readonly queue: QueueItem[] = [];
  readonly subpatterns = new Map<string, TraversalPattern[]>();

  constructor(
    patterns: string[],
    options: NormalizedGlobOptions,
    fileSystem: SyncGlobFileSystem,
  ) {
    this.root = options.cwd;
    this.withFileTypes = options.withFileTypes;
    this.followSymlinks = options.followSymlinks;
    this.cache = new SyncGlobCache(fileSystem);
    this.patterns = compileTraversalPatterns(patterns);

    let isExcluded = (_absolutePath: string): boolean => false;
    if (Array.isArray(options.exclude)) {
      const exclusions = compileStringExclusions(this.root, options.exclude);
      isExcluded = (absolutePath: string): boolean =>
        matchesCompiledGlobPatterns(absolutePath, exclusions, false);
    } else {
      this.callbackExclude = options.exclude;
    }
    this.results = new GlobResults(this.root, isExcluded);
  }

  run(): Array<string | Dirent> {
    this.queue.push({ path: ".", patterns: this.patterns });
    while (this.queue.length !== 0) {
      const item = this.queue.pop();
      if (item === undefined) throw new Error("glob queue lost its final item");
      for (let index = 0; index < item.patterns.length; index++) {
        const pattern = item.patterns[index];
        if (pattern !== undefined) this.addSubpatterns(item.path, pattern);
      }
      this.subpatterns.forEach((patterns, path) => {
        this.queue.push({ path, patterns });
      });
      this.subpatterns.clear();
    }

    if (!this.withFileTypes) return this.results.values;
    const entries = new Array<Dirent>(this.results.values.length);
    for (let index = 0; index < this.results.values.length; index++) {
      const path = this.results.values[index];
      if (path === undefined) throw new Error(`glob result is missing path ${index}`);
      const fullpath = isAbsolutePath(path) ? path : joinPath(this.root, path);
      const entry = this.cache.lstat(fullpath);
      if (entry === null) throw new Error(`glob result disappeared: ${path}`);
      entries[index] = entry;
    }
    return entries;
  }

  private isDirectory(path: string, stat: Dirent | null, pattern: TraversalPattern): boolean {
    if (stat?.isDirectory()) return true;
    if (!stat?.isSymbolicLink()) return false;
    if (this.followSymlinks) return this.cache.followStat(path)?.isDirectory() === true;
    return pattern.hasSeenSymlinks();
  }

  private isCyclic(path: string, isDirectory: boolean, pattern: TraversalPattern): boolean {
    if (!this.followSymlinks || !isDirectory) return false;
    const real = this.cache.realpath(path);
    return real !== null && pattern.realpaths.has(real);
  }

  private nextRealpaths(
    path: string,
    isDirectory: boolean,
    pattern: TraversalPattern,
  ): Set<string> {
    if (!this.followSymlinks || !isDirectory) return pattern.realpaths;
    const real = this.cache.realpath(path);
    if (real === null) return pattern.realpaths;
    const realpaths = copyStringSet(pattern.realpaths);
    realpaths.add(real);
    return realpaths;
  }

  private addSubpattern(path: string, pattern: TraversalPattern): void {
    const fullpath = resolvePath(this.root, path);
    if (this.results.isExcluded(fullpath)) return;
    const stat = this.cache.lstat(fullpath);
    if (this.results.isExcluded(`${fullpath}/`) && stat?.isDirectory()) return;

    if (this.callbackExclude !== undefined) {
      if (this.withFileTypes) {
        if (stat !== null && this.callbackExclude(stat)) return;
      } else if (this.callbackExclude(path)) {
        return;
      }
    }
    const current = this.subpatterns.get(path);
    if (current === undefined) this.subpatterns.set(path, [pattern]);
    else current.push(pattern);
  }

  private addSubpatterns(path: string, pattern: TraversalPattern): void {
    if (this.cache.add(path, pattern)) return;
    const fullpath = resolvePath(this.root, path);
    const stat = this.cache.lstat(fullpath);
    const last = pattern.last;
    const isDirectory = this.isDirectory(fullpath, stat, pattern);
    const isLast = pattern.isLast(isDirectory);
    const isFirst = pattern.isFirst();

    if (this.results.isExcluded(fullpath)) return;
    if (isFirst && pattern.at(0) === "") {
      this.addSubpattern("/", pattern.child(new Set<number>([1])));
      return;
    }
    if (isFirst && pattern.at(0) === "..") {
      this.addSubpattern("../", pattern.child(new Set<number>([1])));
      return;
    }
    if (isFirst && pattern.at(0) === ".") {
      this.addSubpattern(".", pattern.child(new Set<number>([1])));
      return;
    }

    const finalPart = pattern.at(-1);
    if (isLast && typeof finalPart === "string") {
      const childStat = this.cache.lstat(joinPath(fullpath, finalPart));
      if (childStat !== null && (finalPart.length !== 0 || isDirectory)) {
        this.results.add(joinPath(path, finalPart));
      }
      if (pattern.indexes.size === 1 && pattern.indexes.has(last)) return;
    } else if (isLast && finalPart instanceof GlobStar &&
      (path !== "." || pattern.at(0) === "." || (last === 0 && stat !== null))) {
      this.results.add(path);
    }

    if (!isDirectory || this.isCyclic(fullpath, isDirectory, pattern)) return;
    const nextRealpaths = this.nextRealpaths(fullpath, isDirectory, pattern);

    let children: Dirent[];
    const onlyIndex = pattern.indexes.size === 1 ? firstNumber(pattern.indexes) : undefined;
    const firstPart = onlyIndex === undefined ? undefined : pattern.at(onlyIndex);
    if (typeof firstPart === "string") {
      const child = this.cache.lstat(joinPath(fullpath, firstPart));
      if (child === null) return;
      children = [child];
    } else {
      children = this.cache.readdir(fullpath);
    }

    for (let childIndex = 0; childIndex < children.length; childIndex++) {
      const entry = children[childIndex];
      if (entry === undefined) throw new Error(`glob directory is missing entry ${childIndex}`);
      const entryPath = joinPath(path, entry.name);
      const entryFullpath = joinPath(fullpath, entry.name);
      this.cache.addStat(entryFullpath, entry);
      const entryIsDirectory = entry.isDirectory() ||
        (this.followSymlinks && entry.isSymbolicLink() &&
         this.cache.followStat(entryFullpath)?.isDirectory() === true);

      const childIndexes = new Set<number>();
      const childSymlinks = new Set<number>();
      for (const index of pattern.indexes) {
        if (this.cache.seen(entryPath, pattern, index) ||
            this.cache.seen(entryPath, pattern, index + 1)) return;
        const current = pattern.at(index);
        const nextIndex = index + 1;
        const next = pattern.at(nextIndex);
        const fromSymlink = !this.followSymlinks && pattern.symlinks.has(index);

        if (current instanceof GlobStar) {
          const isDot = entry.name.charAt(0) === ".";
          const nextMatches = pattern.test(nextIndex, entry.name);
          let nextNonGlobIndex = nextIndex;
          while (pattern.at(nextNonGlobIndex) instanceof GlobStar) nextNonGlobIndex++;
          const matchesDot = isDot && pattern.test(nextNonGlobIndex, entry.name);

          const excludeValue = this.withFileTypes ? entry : entry.name;
          if ((isDot && !matchesDot) ||
              (this.callbackExclude !== undefined && this.callbackExclude(excludeValue))) {
            continue;
          }
          if (!fromSymlink && entryIsDirectory) childIndexes.add(index);
          else if (!fromSymlink && index === last) this.results.add(entryPath);

          if (nextMatches && nextIndex === last && !isLast) {
            this.results.add(entryPath);
          } else if (nextMatches && entryIsDirectory) {
            childIndexes.add(index + 2);
          }
          if ((nextMatches || pattern.at(0) === ".") &&
              (entryIsDirectory || entry.isSymbolicLink()) && !fromSymlink) {
            childIndexes.add(nextIndex);
          }
          if (!this.followSymlinks && entry.isSymbolicLink()) childSymlinks.add(index);

          if (next === ".." && entryIsDirectory) {
            const parent = joinPath(path, "..");
            if (nextIndex < last) {
              if (!this.subpatterns.has(path) &&
                  !this.cache.seen(path, pattern, nextIndex + 1)) {
                this.subpatterns.set(path, [
                  pattern.child(new Set<number>([nextIndex + 1])),
                ]);
              }
              if (!this.subpatterns.has(parent) &&
                  !this.cache.seen(parent, pattern, nextIndex + 1)) {
                this.subpatterns.set(parent, [
                  pattern.child(new Set<number>([nextIndex + 1])),
                ]);
              }
            } else {
              if (!this.cache.seen(path, pattern, nextIndex)) {
                const child = pattern.child(new Set<number>([nextIndex]));
                this.cache.add(path, child);
                this.results.add(path);
              }
              if (!this.cache.seen(path, pattern, nextIndex) ||
                  !this.cache.seen(parent, pattern, nextIndex)) {
                const child = pattern.child(new Set<number>([nextIndex]));
                this.cache.add(parent, child);
                this.results.add(parent);
              }
            }
          }
        }

        if (typeof current === "string") {
          if (pattern.test(index, entry.name) && index !== last) {
            childIndexes.add(nextIndex);
          } else if (current === "." && pattern.test(nextIndex, entry.name)) {
            if (nextIndex === last) this.results.add(entryPath);
            else childIndexes.add(nextIndex + 1);
          }
        } else if (current instanceof GlobSegmentMatcher && pattern.test(index, entry.name)) {
          if (index === last) this.results.add(entryPath);
          else if (entryIsDirectory) childIndexes.add(nextIndex);
        }
      }
      if (childIndexes.size !== 0) {
        this.addSubpattern(
          entryPath,
          pattern.child(childIndexes, childSymlinks, nextRealpaths),
        );
      }
    }
  }
}

class AsyncGlobWalker {
  readonly root: string;
  readonly withFileTypes: boolean;
  readonly followSymlinks: boolean;
  readonly callbackExclude: ((value: string | Dirent) => boolean) | undefined;
  readonly cache: AsyncGlobCache;
  readonly results: GlobResults;
  readonly patterns: TraversalPattern[];
  readonly queue: QueueItem[] = [];
  readonly subpatterns = new Map<string, TraversalPattern[]>();

  constructor(
    patterns: string[],
    options: NormalizedGlobOptions,
    fileSystem: AsyncGlobFileSystem,
  ) {
    this.root = options.cwd;
    this.withFileTypes = options.withFileTypes;
    this.followSymlinks = options.followSymlinks;
    this.cache = new AsyncGlobCache(fileSystem);
    this.patterns = compileTraversalPatterns(patterns);

    let isExcluded = (_absolutePath: string): boolean => false;
    if (Array.isArray(options.exclude)) {
      const exclusions = compileStringExclusions(this.root, options.exclude);
      isExcluded = (absolutePath: string): boolean =>
        matchesCompiledGlobPatterns(absolutePath, exclusions, false);
    } else {
      this.callbackExclude = options.exclude;
    }
    this.results = new GlobResults(this.root, isExcluded);
  }

  async run(): Promise<Array<string | Dirent>> {
    this.queue.push({ path: ".", patterns: this.patterns });
    while (this.queue.length !== 0) {
      const item = this.queue.pop();
      if (item === undefined) throw new Error("glob queue lost its final item");
      for (let index = 0; index < item.patterns.length; index++) {
        const pattern = item.patterns[index];
        if (pattern !== undefined) await this.addSubpatterns(item.path, pattern);
      }
      this.subpatterns.forEach((patterns, path) => {
        this.queue.push({ path, patterns });
      });
      this.subpatterns.clear();
    }

    if (!this.withFileTypes) return this.results.values;
    const entries = new Array<Dirent>(this.results.values.length);
    for (let index = 0; index < this.results.values.length; index++) {
      const path = this.results.values[index];
      if (path === undefined) throw new Error(`glob result is missing path ${index}`);
      const fullpath = isAbsolutePath(path) ? path : joinPath(this.root, path);
      const entry = await this.cache.lstat(fullpath);
      if (entry === null) throw new Error(`glob result disappeared: ${path}`);
      entries[index] = entry;
    }
    return entries;
  }

  private async isDirectory(
    path: string,
    stat: Dirent | null,
    pattern: TraversalPattern,
  ): Promise<boolean> {
    if (stat?.isDirectory()) return true;
    if (!stat?.isSymbolicLink()) return false;
    if (this.followSymlinks) return (await this.cache.followStat(path))?.isDirectory() === true;
    return pattern.hasSeenSymlinks();
  }

  private async isCyclic(
    path: string,
    isDirectory: boolean,
    pattern: TraversalPattern,
  ): Promise<boolean> {
    if (!this.followSymlinks || !isDirectory) return false;
    const real = await this.cache.realpath(path);
    return real !== null && pattern.realpaths.has(real);
  }

  private async nextRealpaths(
    path: string,
    isDirectory: boolean,
    pattern: TraversalPattern,
  ): Promise<Set<string>> {
    if (!this.followSymlinks || !isDirectory) return pattern.realpaths;
    const real = await this.cache.realpath(path);
    if (real === null) return pattern.realpaths;
    const realpaths = copyStringSet(pattern.realpaths);
    realpaths.add(real);
    return realpaths;
  }

  private async addSubpattern(path: string, pattern: TraversalPattern): Promise<void> {
    const fullpath = resolvePath(this.root, path);
    if (this.results.isExcluded(fullpath)) return;
    const stat = await this.cache.lstat(fullpath);
    if (this.results.isExcluded(`${fullpath}/`) && stat?.isDirectory()) return;

    if (this.callbackExclude !== undefined) {
      if (this.withFileTypes) {
        if (stat !== null && this.callbackExclude(stat)) return;
      } else if (this.callbackExclude(path)) {
        return;
      }
    }
    const current = this.subpatterns.get(path);
    if (current === undefined) this.subpatterns.set(path, [pattern]);
    else current.push(pattern);
  }

  private async addSubpatterns(path: string, pattern: TraversalPattern): Promise<void> {
    if (this.cache.add(path, pattern)) return;
    const fullpath = resolvePath(this.root, path);
    const stat = await this.cache.lstat(fullpath);
    const last = pattern.last;
    const isDirectory = await this.isDirectory(fullpath, stat, pattern);
    const isLast = pattern.isLast(isDirectory);
    const isFirst = pattern.isFirst();

    if (this.results.isExcluded(fullpath)) return;
    if (isFirst && pattern.at(0) === "") {
      await this.addSubpattern("/", pattern.child(new Set<number>([1])));
      return;
    }
    if (isFirst && pattern.at(0) === "..") {
      await this.addSubpattern("../", pattern.child(new Set<number>([1])));
      return;
    }
    if (isFirst && pattern.at(0) === ".") {
      await this.addSubpattern(".", pattern.child(new Set<number>([1])));
      return;
    }

    const finalPart = pattern.at(-1);
    if (isLast && typeof finalPart === "string") {
      const childStat = await this.cache.lstat(joinPath(fullpath, finalPart));
      if (childStat !== null && (finalPart.length !== 0 || isDirectory)) {
        this.results.add(joinPath(path, finalPart));
      }
      if (pattern.indexes.size === 1 && pattern.indexes.has(last)) return;
    } else if (isLast && finalPart instanceof GlobStar &&
      (path !== "." || pattern.at(0) === "." || (last === 0 && stat !== null))) {
      this.results.add(path);
    }

    if (!isDirectory || await this.isCyclic(fullpath, isDirectory, pattern)) return;
    const nextRealpaths = await this.nextRealpaths(fullpath, isDirectory, pattern);

    let children: Dirent[];
    const onlyIndex = pattern.indexes.size === 1 ? firstNumber(pattern.indexes) : undefined;
    const firstPart = onlyIndex === undefined ? undefined : pattern.at(onlyIndex);
    if (typeof firstPart === "string") {
      const child = await this.cache.lstat(joinPath(fullpath, firstPart));
      if (child === null) return;
      children = [child];
    } else {
      children = await this.cache.readdir(fullpath);
    }

    for (let childIndex = 0; childIndex < children.length; childIndex++) {
      const entry = children[childIndex];
      if (entry === undefined) throw new Error(`glob directory is missing entry ${childIndex}`);
      const entryPath = joinPath(path, entry.name);
      const entryFullpath = joinPath(fullpath, entry.name);
      this.cache.addStat(entryFullpath, entry);
      const entryIsDirectory = entry.isDirectory() ||
        (this.followSymlinks && entry.isSymbolicLink() &&
         (await this.cache.followStat(entryFullpath))?.isDirectory() === true);

      const childIndexes = new Set<number>();
      const childSymlinks = new Set<number>();
      for (const index of pattern.indexes) {
        if (this.cache.seen(entryPath, pattern, index) ||
            this.cache.seen(entryPath, pattern, index + 1)) return;
        const current = pattern.at(index);
        const nextIndex = index + 1;
        const next = pattern.at(nextIndex);
        const fromSymlink = !this.followSymlinks && pattern.symlinks.has(index);

        if (current instanceof GlobStar) {
          const isDot = entry.name.charAt(0) === ".";
          const nextMatches = pattern.test(nextIndex, entry.name);
          let nextNonGlobIndex = nextIndex;
          while (pattern.at(nextNonGlobIndex) instanceof GlobStar) nextNonGlobIndex++;
          const matchesDot = isDot && pattern.test(nextNonGlobIndex, entry.name);

          const excludeValue = this.withFileTypes ? entry : entry.name;
          if ((isDot && !matchesDot) ||
              (this.callbackExclude !== undefined && this.callbackExclude(excludeValue))) {
            continue;
          }
          if (!fromSymlink && entryIsDirectory) childIndexes.add(index);
          else if (!fromSymlink && index === last) this.results.add(entryPath);

          if (nextMatches && nextIndex === last && !isLast) {
            this.results.add(entryPath);
          } else if (nextMatches && entryIsDirectory) {
            childIndexes.add(index + 2);
          }
          if ((nextMatches || pattern.at(0) === ".") &&
              (entryIsDirectory || entry.isSymbolicLink()) && !fromSymlink) {
            childIndexes.add(nextIndex);
          }
          if (!this.followSymlinks && entry.isSymbolicLink()) childSymlinks.add(index);

          if (next === ".." && entryIsDirectory) {
            const parent = joinPath(path, "..");
            if (nextIndex < last) {
              if (!this.subpatterns.has(path) &&
                  !this.cache.seen(path, pattern, nextIndex + 1)) {
                this.subpatterns.set(path, [
                  pattern.child(new Set<number>([nextIndex + 1])),
                ]);
              }
              if (!this.subpatterns.has(parent) &&
                  !this.cache.seen(parent, pattern, nextIndex + 1)) {
                this.subpatterns.set(parent, [
                  pattern.child(new Set<number>([nextIndex + 1])),
                ]);
              }
            } else {
              if (!this.cache.seen(path, pattern, nextIndex)) {
                const child = pattern.child(new Set<number>([nextIndex]));
                this.cache.add(path, child);
                this.results.add(path);
              }
              if (!this.cache.seen(path, pattern, nextIndex) ||
                  !this.cache.seen(parent, pattern, nextIndex)) {
                const child = pattern.child(new Set<number>([nextIndex]));
                this.cache.add(parent, child);
                this.results.add(parent);
              }
            }
          }
        }

        if (typeof current === "string") {
          if (pattern.test(index, entry.name) && index !== last) {
            childIndexes.add(nextIndex);
          } else if (current === "." && pattern.test(nextIndex, entry.name)) {
            if (nextIndex === last) this.results.add(entryPath);
            else childIndexes.add(nextIndex + 1);
          }
        } else if (current instanceof GlobSegmentMatcher && pattern.test(index, entry.name)) {
          if (index === last) this.results.add(entryPath);
          else if (entryIsDirectory) childIndexes.add(nextIndex);
        }
      }
      if (childIndexes.size !== 0) {
        await this.addSubpattern(
          entryPath,
          pattern.child(childIndexes, childSymlinks, nextRealpaths),
        );
      }
    }
  }
}

export function globSyncWithFileSystem(
  pattern: unknown,
  options: unknown,
  fileSystem: SyncGlobFileSystem,
): Array<string | Dirent> {
  const normalized = normalizeGlobOptions(pattern, options);
  return new SyncGlobWalker(
    normalized.patterns,
    normalized.options,
    fileSystem,
  ).run();
}

export function globWithFileSystem(
  pattern: unknown,
  options: unknown,
  fileSystem: AsyncGlobFileSystem,
): Promise<Array<string | Dirent>> {
  const normalized = normalizeGlobOptions(pattern, options);
  return new AsyncGlobWalker(
    normalized.patterns,
    normalized.options,
    fileSystem,
  ).run();
}

/** Build a public Dirent for a path obtained through `lstat`. */
export function direntFromStats(path: string, stats: Stats): Dirent {
  let type = 0;
  if (stats.isFile()) type = 1;
  else if (stats.isDirectory()) type = 2;
  else if (stats.isSymbolicLink()) type = 3;
  else if (stats.isFIFO()) type = 4;
  else if (stats.isSocket()) type = 5;
  else if (stats.isCharacterDevice()) type = 6;
  else if (stats.isBlockDevice()) type = 7;
  return new Dirent(basenamePath(path), type, dirnamePath(path));
}
