declare const OptimisticKey: unique symbol;

type ReactKey = string | typeof OptimisticKey | null;

type ReactNode =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | ReactElement
  | Iterable<ReactNode>;

type ReactNodeBoundary =
  | object
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | Iterable<ReactNodeBoundary>;

type ReactElement = {
  readonly key: ReactKey;
  readonly children: ReactNode;
};

export function keyKind(element: ReactElement): number {
  if (element.key === null) return 0;
  if (typeof element.key === 'string') return 1;
  return 2;
}

export function firstChild(element: ReactElement): ReactNode {
  return element.children;
}

export function carryNode(node: ReactNodeBoundary): ReactNodeBoundary {
  return node;
}
