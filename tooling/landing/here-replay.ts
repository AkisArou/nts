import { spawnSync } from 'node:child_process';
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, rmdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';
import { durableBytes, durableRecord } from '../gate/durable-record.ts';
import type { GateResource } from '../gate/gate-resource.ts';
import { gitArguments } from '../gate/git-arguments/main.ts';
import { reapGateRoot } from '../gate/scopes/step-scope.ts';
import { dependencyHash, installationCatalogBytes } from '../inputs/dependency-catalog.ts';
import { installationCatalogPath, installationCatalogState, installationIdentityPath, installationRoots } from '../inputs/dependency-inputs.ts';
import { linkTree } from '../inputs/linker.ts';
import { certifyCandidateGroups } from './candidate-environment.ts';
import { HERE_REF, hereRestore, hereRestorePath, type HereRestore } from './here-restore-record.ts';

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

function linksIn(tree: string): Record<string, string> {
  const thirdParty = join(tree, 'third_party');
  let links: Record<string, string> = {};
  try {
    if (lstatSync(thirdParty).isDirectory()) {
      links = Object.fromEntries(readdirSync(thirdParty, { withFileTypes: true })
        .filter(entry => entry.isSymbolicLink()).map(entry => entry.name).sort()
        .map(name => [name, readlinkSync(join(thirdParty, name))]));
    }
  } catch (error) { if (!missing(error)) throw error; }
  return links;
}

function syncDirectory(path: string): void {
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function renameDurably(from: string, to: string): void {
  renameSync(from, to);
  syncDirectory(dirname(from));
  syncDirectory(dirname(to));
}

function identity(path: string): {device: string; inode: string} | null {
  try {
    const stat = lstatSync(path, {bigint: true});
    return {device:String(stat.dev), inode:String(stat.ino)};
  } catch (error) { if (!missing(error)) throw error; return null; }
}

function fileBytes(path: string): Buffer | null {
  try { return installationCatalogBytes(path); }
  catch (error) { if (!missing(error)) throw error; return null; }
}

function putBack(path: string, bytes: string | null): void {
  if (bytes !== null) durableBytes(path, Buffer.from(bytes, 'base64'));
  else if (identity(path)) { unlinkSync(path); syncDirectory(dirname(path)); }
}

/** The caller holds the same resource lock as pinned gates and pool mutations.
 * Git and the linker inherit it so a killed parent cannot abandon a writer. */
export class HereCheckout {
  readonly tree: string;
  readonly resource: GateResource;
  constructor(tree: string, resource: GateResource) {
    this.tree = tree;
    this.resource = resource;
  }

  private git(args: string[], absentStatus?: number, raw = false): string {
    const result = spawnSync('git', gitArguments(['-c', 'core.fsync=all', ...args]), {
      cwd: this.tree, encoding: 'utf8', stdio: this.resource.stdio('pipe'), maxBuffer: 64 << 20,
    });
    if (absentStatus !== undefined && result.status === absentStatus) return '';
    if (result.status !== 0) throw Error(`git ${args.join(' ')} in ${this.tree}: ${result.error?.message ?? (result.stderr.trim() || result.signal || result.status)}`);
    return raw ? result.stdout : result.stdout.trim();
  }

  head(): string { return this.git(['rev-parse', 'HEAD']); }
  branch(): string { return this.git(['symbolic-ref', '--quiet', '--short', 'HEAD'], 1); }
  dirty(untracked: 'normal' | 'no' = 'normal'): string { return this.git(['status', '--porcelain', `--untracked-files=${untracked}`]); }

  private get parking(): string { return `${this.tree}.here-inputs`; }

  /** Refuse to traverse an importer parent outside the checkout. */
  private modulePath(relative: string): string {
    const path = join(this.tree, relative), parent = dirname(path);
    try {
      const physical = realpathSync(parent);
      if (physical !== this.tree && !physical.startsWith(this.tree + sep)) throw Error(`installation root escapes its checkout: ${path}`);
    } catch (error) { if (!missing(error)) throw error; }
    return path;
  }

  prepare(root: string, run: string, branch: string, head: string, tip: string): HereRestore {
    if (identity(this.parking)) throw Error(`--here parking directory already exists: ${this.parking}`);
    const catalog = fileBytes(installationCatalogPath(root, this.tree));
    const installation = fileBytes(installationIdentityPath(root, this.tree));
    const state = installationCatalogState(root, this.tree);
    if (state.state === 'stale') throw Error(state.message);
    const previous = installation ? (JSON.parse(installation.toString('utf8')) as {importers?:unknown}).importers : undefined;
    if (previous !== undefined && (!Array.isArray(previous) || previous.some(path => typeof path !== 'string' || !path || path.split(sep).includes('..') || path.startsWith(sep)))) {
      throw Error(`invalid installation importer inventory in ${this.tree}`);
    }
    const importers = [...new Set([...(state.state === 'current' ? state.catalog.identity.importers : []), ...(previous as string[] | undefined ?? [])])];
    const originalFiles = this.git(['ls-files', '-z'], undefined, true).split('\0').filter(Boolean);
    const original = new Set(installationRoots(originalFiles, importers));
    const candidate = installationRoots(this.git(['ls-tree', '-r', '--name-only', '-z', tip], undefined, true).split('\0').filter(Boolean), importers);
    const parked: HereRestore['inputs']['parked'] = [];
    for (const path of new Set([...original, ...candidate])) {
      const found = identity(this.modulePath(path));
      if (!found) continue;
      // A candidate may make a former tracked fixture into an install target.
      if (!original.has(path) && originalFiles.some(file => file === path || file.startsWith(path + sep))) continue;
      parked.push({path, slot:String(parked.length), ...found});
    }
    const record: HereRestore = { version: 2, phase: 'parking', branch, head, tip, ref: HERE_REF, run: basename(run), inputs: {
      root, links: linksIn(this.tree), candidate, parked,
      catalog: catalog === null ? null : { bytes: catalog.toString('base64'), sha256: dependencyHash(catalog) },
      installation: installation?.toString('base64') ?? null,
    } };
    durableRecord(hereRestorePath(this.tree), record);
    return record;
  }

  private transition(record: HereRestore, phase: HereRestore['phase']): void {
    durableRecord(hereRestorePath(this.tree), { ...record, phase });
  }

  private verifyRoot(path: string, saved: HereRestore['inputs']['parked'][number]): void {
    const found = identity(path);
    if (!found || found.device !== saved.device || found.inode !== saved.inode) throw Error(`installation root identity changed: ${path}`);
  }

  mount(record: HereRestore): void {
    mkdirSync(this.parking, {mode:0o700});
    syncDirectory(dirname(this.parking));
    for (const saved of record.inputs.parked) {
      const path = this.modulePath(saved.path);
      this.verifyRoot(path, saved);
      renameDurably(path, join(this.parking, saved.slot));
    }
    this.transition(record, 'checking');
    this.git(['update-ref', '--no-deref', record.ref, record.tip, '']);
    this.git(['switch', '-q', '--detach', '--no-overwrite-ignore', record.tip]);
    linkTree(this.tree, 'gate', record.inputs.root, { resource: this.resource });
  }

  recover(root: string, runs: string, record: HereRestore): void {
    certifyCandidateGroups(join(runs, record.run, 'candidate-groups'));
    reapGateRoot(join(this.tree, 'target', 'gate-scope-owner.json'));
    this.restore(root, record);
  }

  restore(root: string, original: HereRestore): void {
    const record = hereRestore(this.tree);
    if (!record || record.tip !== original.tip || record.head !== original.head) throw Error(`restore record changed in ${this.tree}`);
    const { branch, head, tip, ref, inputs } = record;
    if (root !== inputs.root) throw Error(`restore input root changed from ${inputs.root} to ${root}`);
    if (inputs.catalog && dependencyHash(Buffer.from(inputs.catalog.bytes, 'base64')) !== inputs.catalog.sha256) {
      throw Error(`saved installation catalog hash differs in ${hereRestorePath(this.tree)}`);
    }
    const taskHead = this.git(['rev-parse', '--verify', `refs/heads/${branch}`]);
    if (taskHead !== head) throw Error(`restore branch ${branch} moved from ${head} to ${taskHead}`);
    const pinned = this.git(['rev-parse', '--verify', '--quiet', ref], 1);
    if (pinned && pinned !== tip) throw Error(`restore ref ${ref} moved from ${tip} to ${pinned}`);
    const currentBranch = this.branch(), currentHead = this.head();
    if (!(currentBranch === branch && currentHead === head) && !(currentBranch === '' && currentHead === tip)) {
      throw Error(`cannot restore ${branch} from a checkout at ${currentBranch || 'detached'} ${currentHead}`);
    }
    const dirty = this.dirty('no');
    if (dirty) throw Error(`cannot restore ${branch} over uncommitted changes:\n${dirty}`);
    if (!currentBranch) {
      if (record.phase !== 'checking') throw Error(`unexpected detached HEAD while ${record.phase} inputs in ${this.tree}`);
      for (const relative of inputs.candidate) {
        const path = this.modulePath(relative);
        if (identity(path)) { rmSync(path, {recursive:true}); syncDirectory(dirname(path)); }
      }
      this.git(['switch', '-q', '--no-guess', '--no-overwrite-ignore', branch]);
    }
    if (record.phase !== 'returning') this.transition(record, 'returning');
    for (const saved of inputs.parked) {
      const destination = this.modulePath(saved.path), parked = join(this.parking, saved.slot);
      if (identity(parked)) {
        this.verifyRoot(parked, saved);
        if (identity(destination)) throw Error(`refusing to replace installation root at ${destination}`);
        mkdirSync(dirname(destination), {recursive:true});
        renameDurably(parked, destination);
      }
      this.verifyRoot(destination, saved);
    }
    this.restoreLinks(inputs.links);
    const catalogPath = installationCatalogPath(root, this.tree);
    putBack(catalogPath, inputs.catalog?.bytes ?? null);
    putBack(installationIdentityPath(root, this.tree), inputs.installation);
    const catalog = fileBytes(catalogPath);
    if ((catalog === null ? null : dependencyHash(catalog)) !== (inputs.catalog?.sha256 ?? null)) throw Error(`restored installation catalog hash differs: ${catalogPath}`);
    const state = installationCatalogState(root, this.tree);
    if (state.state === 'stale') throw Error(state.message);
    if (state.state === 'current') for (const entry of state.catalog.entries) {
      if (entry.kind === 'link' && readlinkSync(join(this.tree, entry.path)) !== entry.target) throw Error(`restored dependency link target differs: ${entry.path}`);
    }
    if (identity(this.parking)) { rmdirSync(this.parking); syncDirectory(dirname(this.parking)); }
    if (pinned) this.git(['update-ref', '-d', '--no-deref', ref, tip]);
    const path = hereRestorePath(this.tree);
    unlinkSync(path);
    syncDirectory(dirname(path));
  }

  private restoreLinks(original: Record<string, string>): void {
    const directory = join(this.tree, 'third_party'), current = linksIn(this.tree);
    if (JSON.stringify(current) === JSON.stringify(original)) return;
    if (!lstatSync(directory).isDirectory()) throw Error(`cannot restore links into ${directory}`);
    for (const [name, target] of Object.entries(current)) {
      if (original[name] !== target) unlinkSync(join(directory, name));
    }
    for (const [name, target] of Object.entries(original)) {
      if (current[name] !== target) symlinkSync(target, join(directory, name));
    }
    syncDirectory(directory);
    if (JSON.stringify(linksIn(this.tree)) !== JSON.stringify(original)) throw Error(`restored link targets differ in ${directory}`);
  }
}
