import {
  BadgeCount,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  IconButton,
} from '@budget-tracker/ui';
import { ListFilter } from 'lucide-react';

interface DatePreset {
  key: string;
  label: string;
  dateFrom: string;
  dateTo: string;
}

const TYPE_OPTIONS = [
  { value: 'EXPENSE', label: 'Expense' },
  { value: 'INCOME', label: 'Income' },
  { value: 'TRANSFER', label: 'Transfer' },
  { value: 'REFUND', label: 'Refund' },
  { value: 'TRADE', label: 'Trade' },
];

interface LedgerFilterMenuProps {
  filterTypes: string[];
  setFilterTypes: (fn: (prev: string[]) => string[]) => void;
  filterDatePreset: string | undefined;
  setFilterDatePreset: (fn: (prev: string | undefined) => string | undefined) => void;
  filterLinkedToRecurring: boolean | undefined;
  setFilterLinkedToRecurring: (fn: (prev: boolean | undefined) => boolean | undefined) => void;
  sortOrder: 'newest' | 'oldest';
  setSortOrder: (v: 'newest' | 'oldest') => void;
  datePresets: DatePreset[];
  activeFilterCount: number;
}

export default function LedgerFilterMenu({
  filterTypes,
  setFilterTypes,
  filterDatePreset,
  setFilterDatePreset,
  filterLinkedToRecurring,
  setFilterLinkedToRecurring,
  sortOrder,
  setSortOrder,
  datePresets,
  activeFilterCount,
}: LedgerFilterMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton icon={<ListFilter size={14} />} tooltip="Filters" size="sm" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Filter</DropdownMenuLabel>

        {/* Type */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <span style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
              Type
              {filterTypes.length > 0 && (
                <BadgeCount size="xs" style={{ marginLeft: 'auto' }}>
                  {filterTypes.length}
                </BadgeCount>
              )}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {TYPE_OPTIONS.map((opt) => (
              <DropdownMenuItem
                key={opt.value}
                checked={filterTypes.includes(opt.value)}
                checkStyle="check"
                closeOnSelect={false}
                onSelect={() =>
                  setFilterTypes((prev) =>
                    prev.includes(opt.value)
                      ? prev.filter((v) => v !== opt.value)
                      : [...prev, opt.value],
                  )
                }
              >
                {opt.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* Recurring */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <span style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
              Recurring
              {filterLinkedToRecurring !== undefined && (
                <BadgeCount size="xs" style={{ marginLeft: 'auto' }}>
                  1
                </BadgeCount>
              )}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem
              checked={filterLinkedToRecurring === true}
              checkStyle="dot"
              closeOnSelect={false}
              onSelect={() =>
                setFilterLinkedToRecurring((prev) => (prev === true ? undefined : true))
              }
            >
              Yes
            </DropdownMenuItem>
            <DropdownMenuItem
              checked={filterLinkedToRecurring === false}
              checkStyle="dot"
              closeOnSelect={false}
              onSelect={() =>
                setFilterLinkedToRecurring((prev) => (prev === false ? undefined : false))
              }
            >
              No
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* Date */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <span style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
              Date
              {filterDatePreset && (
                <BadgeCount size="xs" style={{ marginLeft: 'auto' }}>
                  1
                </BadgeCount>
              )}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {datePresets.map((preset) => (
              <DropdownMenuItem
                key={preset.key}
                checked={filterDatePreset === preset.key}
                checkStyle="dot"
                closeOnSelect={false}
                onSelect={() =>
                  setFilterDatePreset((prev) => (prev === preset.key ? undefined : preset.key))
                }
              >
                {preset.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Sort</DropdownMenuLabel>
        <DropdownMenuItem
          checked={sortOrder === 'newest'}
          checkStyle="dot"
          closeOnSelect={false}
          onSelect={() => setSortOrder('newest')}
        >
          Newest to Oldest
        </DropdownMenuItem>
        <DropdownMenuItem
          checked={sortOrder === 'oldest'}
          checkStyle="dot"
          closeOnSelect={false}
          onSelect={() => setSortOrder('oldest')}
        >
          Oldest to Newest
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={activeFilterCount === 0}
          onSelect={() => {
            setFilterTypes(() => []);
            setFilterDatePreset(() => undefined);
            setFilterLinkedToRecurring(() => undefined);
          }}
        >
          Clear all filters
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
