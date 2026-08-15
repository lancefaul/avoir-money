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

interface RecurringFilterMenuProps {
  filterTypes: string[];
  setFilterTypes: React.Dispatch<React.SetStateAction<string[]>>;
  filterBudgetIds: string[];
  setFilterBudgetIds: React.Dispatch<React.SetStateAction<string[]>>;
  filterAccountIds: string[];
  setFilterAccountIds: React.Dispatch<React.SetStateAction<string[]>>;
  budgetSearch: string;
  setBudgetSearch: (v: string) => void;
  accountSearch: string;
  setAccountSearch: (v: string) => void;
  typeOptions: SelectOption[];
  filteredBudgetOptions: SelectOption[];
  filteredAccountOptions: SelectOption[];
}

export default function RecurringFilterMenu({
  filterTypes,
  setFilterTypes,
  filterBudgetIds,
  setFilterBudgetIds,
  filterAccountIds,
  setFilterAccountIds,
  budgetSearch,
  setBudgetSearch,
  accountSearch,
  setAccountSearch,
  typeOptions,
  filteredBudgetOptions,
  filteredAccountOptions,
}: RecurringFilterMenuProps) {
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
              {filterBudgetIds.length > 0 && (
                <BadgeCount size="xs" style={{ marginLeft: 'auto' }}>
                  {filterBudgetIds.length}
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
                checked={filterBudgetIds.includes(opt.value)}
                checkStyle="check"
                closeOnSelect={false}
                onSelect={() =>
                  setFilterBudgetIds((prev) =>
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
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={
            !(filterTypes.length > 0 || filterBudgetIds.length > 0 || filterAccountIds.length > 0)
          }
          onSelect={() => {
            setFilterTypes([]);
            setFilterBudgetIds([]);
            setFilterAccountIds([]);
          }}
        >
          Clear all filters
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
