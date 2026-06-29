'use client';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

type StatusOption = {
  value: string;
  label?: string;
};

export type StatusMultiSelectFilterProps = {
  label: string;
  summary: string;
  allLabel: string;
  options: readonly StatusOption[];
  selected: readonly string[];
  onToggleStatus: (status: string) => void;
  onToggleAll: () => void;
};

export function StatusMultiSelectFilter({
  label,
  summary,
  allLabel,
  options,
  selected,
  onToggleStatus,
  onToggleAll,
}: StatusMultiSelectFilterProps) {
  const allSelected = options.every((option) => selected.includes(option.value));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="justify-between" aria-label={label}>
          <span>{label}</span>
          <span className="text-xs text-muted-foreground">{summary}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <div className="mb-3 text-sm font-medium">{label}</div>
        <div className="grid gap-2">
          <Label className="flex items-center gap-2 text-sm font-normal">
            <input
              type="checkbox"
              aria-label={allLabel}
              checked={allSelected}
              onChange={onToggleAll}
            />
            <span>{allLabel}</span>
          </Label>
          {options.map((option) => (
            <Label key={option.value} className="flex items-center gap-2 text-sm font-normal">
              <input
                type="checkbox"
                aria-label={option.value}
                checked={selected.includes(option.value)}
                onChange={() => onToggleStatus(option.value)}
              />
              <span>{option.label ?? option.value}</span>
            </Label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
