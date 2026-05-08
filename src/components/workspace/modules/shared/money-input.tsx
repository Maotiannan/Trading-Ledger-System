'use client';

import type { ComponentProps } from 'react';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  formatMoneyInputValue,
  normalizeMoneyInputValue,
  parseDisplayMoney,
  roundDisplayMoney,
} from '@/lib/display-format';

type MoneyInputProps = Omit<ComponentProps<typeof Input>, 'type' | 'value' | 'onChange'> & {
  value: string | number | null | undefined;
  onValueChange: (value: string) => void;
};

export function MoneyInput({ value, onValueChange, onFocus, onBlur, ...props }: MoneyInputProps) {
  const [focused, setFocused] = useState(false);
  const displayValue = focused ? normalizeMoneyInputValue(value) : formatMoneyInputValue(value);

  return (
    <Input
      {...props}
      type="text"
      inputMode="decimal"
      value={displayValue}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onChange={(event) => onValueChange(normalizeMoneyInputValue(event.target.value))}
      onBlur={(event) => {
        const parsed = parseDisplayMoney(event.target.value);
        onValueChange(parsed === null ? '' : String(roundDisplayMoney(parsed)));
        setFocused(false);
        onBlur?.(event);
      }}
    />
  );
}
