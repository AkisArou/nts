// The normal return's slot fact, and controls that destroy that fact.
class Link {
  next: Link | null = null;
  constructor(public value: number) {}
}

function detach(node: Link): Link {
  node.next = null;
  return node;
}

function maybeDetach(node: Link, clear: boolean): Link {
  if (clear) node.next = null;
  return node;
}

function mutateAlias(node: Link, next: Link): void {
  node.next = next;
}

function installClear(node: Link, next: Link, n: number): number {
  node.next = next;
  let answer = node.value;
  for (let i = 0; i < (n & 3); i++) answer += i;
  return answer + node.next.value;
}

function installMaybe(node: Link, next: Link, n: number): number {
  node.next = next;
  let answer = node.value;
  for (let i = 0; i < (n & 3); i++) answer += i;
  return answer + node.next.value;
}

function installAliased(node: Link, next: Link, n: number): number {
  node.next = next;
  let answer = node.value;
  for (let i = 0; i < (n & 3); i++) answer += i;
  return answer + node.next.value;
}

function aliasParameters(a: Link, b: Link, next: Link, n: number): number {
  b.next = next;
  // a and b may name the same object: distinct parameters prove no separation.
  a.next = next;
  let answer = a.value;
  for (let i = 0; i < (n & 3); i++) answer += i;
  return answer + a.next.value;
}

export function cleared(n: number): number {
  const node = new Link(n);
  node.next = new Link(n + 10);
  return installClear(detach(node), new Link(n + 20), n);
}

export function onePathKeepsTheOldReference(n: number): number {
  const node = new Link(n);
  node.next = new Link(n + 10);
  return installMaybe(maybeDetach(node, (n & 1) === 0), new Link(n + 20), n);
}

export function anAliasingCallInvalidatesTheFact(n: number): number {
  const node = detach(new Link(n));
  mutateAlias(node, new Link(n + 10));
  return installAliased(node, new Link(n + 20), n);
}

export function twoParametersCanAlias(n: number): number {
  const node = detach(new Link(n));
  return aliasParameters(node, node, new Link(n + 20), n);
}

export class Published {
  slot: Link | null = null;
  install(node: Link, next: Link, n: number): number {
    node.next = next;
    this.slot = node;
    let answer = node.value;
    for (let i = 0; i < (n & 3); i++) answer += i;
    return answer + node.next.value;
  }
}

export function directPublished(n: number): number {
  const target = new Published();
  return target.install(detach(new Link(n)), new Link(n + 20), n);
}
