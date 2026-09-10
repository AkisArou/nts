type Props = {
  ref?: string;
};

export function hasRef(props: Props): boolean {
  return 'ref' in props;
}
