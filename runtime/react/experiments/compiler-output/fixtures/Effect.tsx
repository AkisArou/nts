import {useEffect} from 'react';

type Props = {
  value: number;
  onChange: (value: number) => void;
};

export function Effect({value, onChange}: Props) {
  useEffect(() => {
    onChange(value);
  }, [onChange, value]);
  return <output>{value}</output>;
}
