import type { KeyboardEvent } from 'react';

export function submitSearchOnEnter(
  event: KeyboardEvent<HTMLInputElement>,
  onSubmit: (value: string) => void,
) {
  const nativeEvent = event.nativeEvent as KeyboardEvent<HTMLInputElement>['nativeEvent'] & { isComposing?: boolean };
  if (event.key !== 'Enter' || nativeEvent.isComposing) return;

  event.preventDefault();
  onSubmit(event.currentTarget.value);
}
