import {
  BadgeCount,
  type SelectOption,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  IconButton,
} from '@budget-tracker/ui';
import { ListFilter } from 'lucide-react';

interface DatePreset {
  key: string;
  label: string;
  dateFrom: string;
  dateTo: string;
}

interface TransactionFilterMenuProps {
  filterTypes: string[];
  setFilterTypes: React.Dispatch<React.SetStateAction<string[]>>;
  filterCategoryIds: string[];
  setFilterCategoryIds: React.Dispatch<React.SetStateAction<string[]>>;
  filterAccountIds: string[];
  setFilterAccountIds: React.Dispatch<React.SetStateAction<string[]>>;
  filterLinkedToRecurring: boolean | undefined;
  setFilterLinkedToRecurring: React.Dispatch<React.SetStateAction<boolean | undefined>>;
  filterDatePreset: string | undefined;
  setFilterDatePreset: React.Dispatch<React.SetStateAction<string | undefined>>;
  sortOrder: 'newest' | 'oldest';
  setSortOrder: React.Dispatch<React.SetStateAction<'newest' | 'oldest'>>;
  budgetSearch: string;
  setBudgetSearch: (v: string) => void;
  accountSearch: string;
  setAccountSearch: (v: string) => void;
  typeOptions: SelectOption[];
  filteredBudgetOptions: SelectOption[];
  filteredAccountOptions: SelectOption[];
  datePresets: DatePreset[];
  /**
   * Display preferences rather than filters: they change which rows the server
   * is asked for, they persist across reloads, and "Clear filters" leaves them
   * alone. Grouped under their own "Show" heading for that reason.
   */
  showAnticipations: boolean;
  setShowAnticipations: (show: boolean) => void;
  showSnoozed: boolean;
  setShowSnoozed: (show: boolean) => void;
}

export default function TransactionFilterMenu({
  filterTypes,
  setFilterTypes,
  filterCategoryIds,
  setFilterCategoryIds,
  filterAccountIds,
  setFilterAccountIds,
  filterLinkedToRecurring,
  setFilterLinkedToRecurring,
  filterDatePreset,
  setFilterDatePreset,
  sortOrder,
  setSortOrder,
  budgetSearch,
  setBudgetSearch,
  accountSearch,
  setAccountSearch,
  typeOptions,
  filteredBudgetOptions,
  filteredAccountOptions,
  datePresets,
  showAnticipations,
  setShowAnticipations,
  showSnoozed,
  setShowSnoozed,
}: TransactionFilterMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton icon={<ListFilter size={14} />} tooltip="Filters" size="sm" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Filter</DropdownMenuLabel>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <span style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
              Type{' '}
              {filterTypes.length > 0 && (
                <BadgeCount size="xs" style={{ marginLeft: 'auto' }}>
                  {filterTypes.length}
                </BadgeCount>
              )}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {typeOptions.map((opt) => (
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
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <span style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
              Budget{' '}
              {filterCategoryIds.length > 0 && (
                <BadgeCount size="xs" style={{ marginLeft: 'auto' }}>
                  {filterCategoryIds.length}
                </BadgeCount>
              )}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            searchable
            searchPlaceholder="Search budgets…"
            searchValue={budgetSearch}
            onSearchChange={setBudgetSearch}
          >
            {filteredBudgetOptions.map((opt) => (
              <DropdownMenuItem
                key={opt.value}
                checked={filterCategoryIds.includes(opt.value)}
                checkStyle="check"
                closeOnSelect={false}
                onSelect={() =>
                  setFilterCategoryIds((prev) =>
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
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <span style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
              Account{' '}
              {filterAccountIds.length > 0 && (
                <BadgeCount size="xs" style={{ marginLeft: 'auto' }}>
                  {filterAccountIds.length}
                </BadgeCount>
              )}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            searchable
            searchPlaceholder="Search accounts…"
            searchValue={accountSearch}
            onSearchChange={setAccountSearch}
          >
            {filteredAccountOptions.map((opt) => (
              <DropdownMenuItem
                key={opt.value}
                checked={filterAccountIds.includes(opt.value)}
                checkStyle="check"
                closeOnSelect={false}
                onSelect={() =>
                  setFilterAccountIds((prev) =>
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
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <span style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
              Recurring{' '}
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
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <span style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
              Date{' '}
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
        <DropdownMenuLabel>Show</DropdownMenuLabel>
        <DropdownMenuItem
          checked={showAnticipations}
          checkStyle="check"
          closeOnSelect={false}
          onSelect={() => setShowAnticipations(!showAnticipations)}
        >
          Upcoming
        </DropdownMenuItem>
        {/*
         * Disabled when Upcoming is off: a snoozed row IS an upcoming row, so
         * asking for snoozed ones while hiding upcoming ones has no effect and
         * would read as a toggle that does nothing.
         */}
        <DropdownMenuItem
          checked={showSnoozed}
          checkStyle="check"
          closeOnSelect={false}
          disabled={!showAnticipations}
          onSelect={() => setShowSnoozed(!showSnoozed)}
        >
          Snoozed
        </DropdownMenuItem>
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
          disabled={
            !(
              filterTypes.length > 0 ||
              filterCategoryIds.length > 0 ||
              filterAccountIds.length > 0 ||
              filterLinkedToRecurring !== undefined ||
              filterDatePreset
            )
          }
          onSelect={() => {
            setFilterTypes([]);
            setFilterCategoryIds([]);
            setFilterAccountIds([]);
            setFilterLinkedToRecurring(undefined);
            setFilterDatePreset(undefined);
          }}
        >
          Clear all filters
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
