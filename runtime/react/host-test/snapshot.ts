import type {HostContainer, HostNode, HostPropValue} from './recording-host.ts';

function propText(value: HostPropValue): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

function nodeText(node: HostNode): string {
  if (node.kind === 'text') {
    return `text#${node.id}(${JSON.stringify(node.text)})${node.hidden ? ':hidden' : ''}`;
  }
  const props = node.props
    .map(prop => `${prop.name}=${propText(prop.value)}`)
    .join(',');
  const children = node.children.map(nodeText).join(',');
  return `instance#${node.id}(${node.type}){${props}}[${children}]${node.hidden ? ':hidden' : ''}`;
}

export function snapshot(container: HostContainer): string {
  return `container#${container.id}[${container.children.map(nodeText).join(',')}]`;
}
