import {RecordingMutationHost} from './recording-host.ts';
import type {HostProp, HostPropValue} from './recording-host.ts';

function checked(condition: boolean): number {
  return condition ? 1 : 0;
}

function prop(name: string, value: HostPropValue): HostProp {
  const result: HostProp = {name, value};
  return result;
}

export function runRecordingHostChecks(): number {
  const host = new RecordingMutationHost();
  const root = host.createContainer();
  const panelProps: HostProp[] = [prop('enabled', true)];
  const buttonProps: HostProp[] = [prop('title', 'Save')];
  const panel = host.createInstance('Panel', panelProps);
  const button = host.createInstance('Button', buttonProps);
  const label = host.createTextInstance('draft');
  let checks = 0;

  checks += checked(root.kind === 'container');
  checks += checked(root.id === 1);
  host.appendInitialChild(button, label);
  host.appendChild(root, panel);
  host.appendChild(root, button);
  checks += checked(root.children.length === 2);
  checks += checked(root.children[0] === panel);
  checks += checked(label.parentId === button.id);

  host.insertBefore(root, button, panel);
  checks += checked(root.children[0] === button);
  const updatedProps: HostProp[] = [
    prop('title', 'Publish'),
    prop('priority', 2),
  ];
  host.commitUpdate(button, updatedProps);
  checks += checked(button.props.length === 2);
  checks += checked(button.props[1]?.value === 2);

  host.commitTextUpdate(label, 'ready');
  checks += checked(label.text === 'ready');
  host.hideTextInstance(label);
  checks += checked(label.hidden);
  host.unhideTextInstance(label);
  checks += checked(!label.hidden);

  host.removeChild(root, panel);
  checks += checked(root.children.length === 1);
  checks += checked(panel.parentId === -1);
  host.clearContainer(root);
  checks += checked(root.children.length === 0);
  checks += checked(button.parentId === -1);
  return checks;
}
