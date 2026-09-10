export type HostPropValue = string | number | boolean | null;

export interface HostProp {
  name: string;
  value: HostPropValue;
}

export type HostKind = 'container' | 'instance' | 'text';

// One physical layout keeps child traversal static in NTS. React's distinct
// opaque host types can all refer to this record in the recording renderer.
export interface HostNode {
  kind: HostKind;
  id: number;
  parentId: number;
  type: string;
  props: HostProp[];
  children: HostNode[];
  text: string;
  hidden: boolean;
}

export type HostContainer = HostNode;
export type HostInstance = HostNode;
export type HostText = HostNode;
export type HostParent = HostNode;

export type MutationName =
  | 'append-initial'
  | 'append'
  | 'insert'
  | 'remove'
  | 'clear'
  | 'update-props'
  | 'update-text'
  | 'reset-text'
  | 'hide'
  | 'unhide';

export interface MutationRecord {
  operation: MutationName;
  parentId: number;
  nodeId: number;
  beforeId: number;
}

function copyProps(props: readonly HostProp[]): HostProp[] {
  const copied: HostProp[] = [];
  for (const prop of props) {
    const entry: HostProp = {name: prop.name, value: prop.value};
    copied.push(entry);
  }
  return copied;
}

function childIndex(parent: HostParent, child: HostNode): number {
  return parent.children.indexOf(child);
}

function attach(
  parent: HostParent,
  child: HostNode,
  before: HostNode | null,
): void {
  if (child.parentId !== -1 && child.parentId !== parent.id) {
    throw new Error('reparenting is not allowed');
  }
  const current = childIndex(parent, child);
  if (current !== -1) parent.children.splice(current, 1);
  if (before === null) {
    parent.children.push(child);
  } else {
    const destination = childIndex(parent, before);
    if (destination === -1) throw new Error('before child does not exist');
    const previousLength = parent.children.length;
    parent.children.push(child);
    for (let index = previousLength; index > destination; index--) {
      const previous = parent.children[index - 1];
      if (previous === undefined) throw new Error('child insertion failed');
      parent.children[index] = previous;
    }
    parent.children[destination] = child;
  }
  child.parentId = parent.id;
}

export class RecordingMutationHost {
  private nextId = 1;
  readonly mutations: MutationRecord[] = [];

  reset(): void {
    this.nextId = 1;
    this.mutations.splice(0, this.mutations.length);
  }

  createContainer(): HostContainer {
    return {
      kind: 'container',
      id: this.nextId++,
      parentId: -1,
      type: '',
      props: [],
      children: [],
      text: '',
      hidden: false,
    };
  }

  createInstance(type: string, props: readonly HostProp[]): HostInstance {
    return {
      kind: 'instance',
      id: this.nextId++,
      parentId: -1,
      type,
      props: copyProps(props),
      children: [],
      text: '',
      hidden: false,
    };
  }

  createTextInstance(text: string): HostText {
    return {
      kind: 'text',
      id: this.nextId++,
      parentId: -1,
      type: '',
      props: [],
      children: [],
      text,
      hidden: false,
    };
  }

  appendInitialChild(parent: HostInstance, child: HostNode): void {
    attach(parent, child, null);
    this.record('append-initial', parent.id, child.id, -1);
  }

  appendChild(parent: HostParent, child: HostNode): void {
    attach(parent, child, null);
    this.record('append', parent.id, child.id, -1);
  }

  insertBefore(parent: HostParent, child: HostNode, before: HostNode): void {
    attach(parent, child, before);
    this.record('insert', parent.id, child.id, before.id);
  }

  removeChild(parent: HostParent, child: HostNode): void {
    const index = childIndex(parent, child);
    if (index === -1) throw new Error('child does not exist');
    parent.children.splice(index, 1);
    child.parentId = -1;
    this.record('remove', parent.id, child.id, -1);
  }

  clearContainer(container: HostContainer): void {
    for (const child of container.children) child.parentId = -1;
    container.children.splice(0, container.children.length);
    this.record('clear', container.id, -1, -1);
  }

  commitUpdate(instance: HostInstance, props: readonly HostProp[]): void {
    instance.props = copyProps(props);
    this.record('update-props', instance.parentId, instance.id, -1);
  }

  commitTextUpdate(text: HostText, newText: string): void {
    text.text = newText;
    this.record('update-text', text.parentId, text.id, -1);
  }

  resetTextContent(instance: HostInstance): void {
    for (const child of instance.children) child.parentId = -1;
    instance.children.splice(0, instance.children.length);
    this.record('reset-text', instance.id, instance.id, -1);
  }

  hideInstance(instance: HostInstance): void {
    instance.hidden = true;
    this.record('hide', instance.parentId, instance.id, -1);
  }

  unhideInstance(instance: HostInstance): void {
    instance.hidden = false;
    this.record('unhide', instance.parentId, instance.id, -1);
  }

  hideTextInstance(text: HostText): void {
    text.hidden = true;
    this.record('hide', text.parentId, text.id, -1);
  }

  unhideTextInstance(text: HostText): void {
    text.hidden = false;
    this.record('unhide', text.parentId, text.id, -1);
  }

  private record(
    operation: MutationName,
    parentId: number,
    nodeId: number,
    beforeId: number,
  ): void {
    this.mutations.push({operation, parentId, nodeId, beforeId});
  }
}
