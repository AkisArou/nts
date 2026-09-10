import {RecordingMutationHost} from './recording-host.ts';
import {snapshot} from './snapshot.ts';

function equal<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function throws(action: () => void, message: string): void {
  try {
    action();
  } catch (error) {
    equal(error instanceof Error ? error.message : String(error), message, 'error');
    return;
  }
  throw new Error(`expected error: ${message}`);
}

const host = new RecordingMutationHost();
const root = host.createContainer();
const otherRoot = host.createContainer();
const panel = host.createInstance('Panel', [{name: 'enabled', value: true}]);
const button = host.createInstance('Button', [{name: 'title', value: 'Save'}]);
const label = host.createTextInstance('draft');

host.appendInitialChild(button, label);
host.appendChild(root, panel);
host.appendChild(root, button);
equal(
  snapshot(root),
  'container#1[instance#3(Panel){enabled=true}[],instance#4(Button){title="Save"}[text#5("draft")]]',
  'mount snapshot',
);

host.insertBefore(root, button, panel);
equal(
  snapshot(root),
  'container#1[instance#4(Button){title="Save"}[text#5("draft")],instance#3(Panel){enabled=true}[]]',
  'insert moves an existing child',
);

host.commitUpdate(button, [
  {name: 'title', value: 'Publish'},
  {name: 'priority', value: 2},
]);
host.commitTextUpdate(label, 'ready');
host.hideTextInstance(label);
host.hideInstance(panel);
equal(
  snapshot(root),
  'container#1[instance#4(Button){title="Publish",priority=2}[text#5("ready"):hidden],instance#3(Panel){enabled=true}[]:hidden]',
  'updates and visibility',
);

host.unhideTextInstance(label);
host.unhideInstance(panel);
host.removeChild(root, panel);
throws(() => host.appendChild(otherRoot, button), 'reparenting is not allowed');
host.clearContainer(root);
equal(snapshot(root), 'container#1[]', 'clear');
equal(button.parentId, -1, 'clear detaches child');

equal(host.mutations.length, 12, 'mutation count');
equal(host.mutations[0]?.operation, 'append-initial', 'initial mutation');
equal(host.mutations[3]?.operation, 'insert', 'reorder mutation');
equal(host.mutations[11]?.operation, 'clear', 'final mutation');

console.log('recording HostConfig kernel: 12 checks passed');
