import { useState } from 'react';
import {
  Pencil,
  Copy,
  Trash2,
  Download,
  MoreHorizontal,
  ChevronDown,
  User,
  Archive,
  Folder,
  Tag,
  Repeat,
  Receipt,
  Building2,
  HandCoins,
  Utensils,
  Car,
  Home,
  Zap,
  Tv,
  Banknote,
  Briefcase,
  TrendingUp,
  BarChart2,
  Share2,
  CalendarClock,
  Link,
  Mail,
  MessageSquare,
  Code2,
  Plus,
  BellOff,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  buttonStyles as btn,
} from '@budget-tracker/ui';
import * as s from '../showcase.css.js';

const noop = () => {};

/* ─── Checked items – radio pattern ─── */

export function CheckedRadioDemo() {
  const [sortBy, setSortBy] = useState('date');
  const [direction, setDirection] = useState('desc');

  return (
    <div className={s.section}>
      <div className={s.sectionLabel}>Checked items – radio pattern</div>
      <div className={s.row}>
        <div className={s.col}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={`${btn.btnBase} ${btn.btnMd} ${btn.btnTrueGhost}`}>
                Sort by <ChevronDown size={12} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuItem checked={sortBy === 'date'} onSelect={() => setSortBy('date')}>
                Date
              </DropdownMenuItem>
              <DropdownMenuItem checked={sortBy === 'amount'} onSelect={() => setSortBy('amount')}>
                Amount
              </DropdownMenuItem>
              <DropdownMenuItem
                checked={sortBy === 'description'}
                onSelect={() => setSortBy('description')}
              >
                Description
              </DropdownMenuItem>
              <DropdownMenuItem
                checked={sortBy === 'category'}
                onSelect={() => setSortBy('category')}
              >
                Category
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Direction</DropdownMenuLabel>
              <DropdownMenuItem
                checked={direction === 'desc'}
                onSelect={() => setDirection('desc')}
              >
                Newest first
              </DropdownMenuItem>
              <DropdownMenuItem checked={direction === 'asc'} onSelect={() => setDirection('asc')}>
                Oldest first
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <span className={s.ann}>sort · radio pattern</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Checked items – checkbox pattern ─── */

export function CheckedCheckboxDemo() {
  const [cols, setCols] = useState({
    date: true,
    description: true,
    category: true,
    amount: true,
    account: false,
    notes: false,
    tags: false,
  });

  const toggle = (key: keyof typeof cols) => setCols((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className={s.section}>
      <div className={s.sectionLabel}>Checked items – checkbox pattern</div>
      <div className={s.row}>
        <div className={s.col}>
          <DropdownMenu>
            <DropdownMenuTrigger />
            <DropdownMenuContent>
              <DropdownMenuItem
                checkStyle="check"
                checked={cols.date}
                onSelect={() => toggle('date')}
              >
                Date
              </DropdownMenuItem>
              <DropdownMenuItem
                checkStyle="check"
                checked={cols.description}
                onSelect={() => toggle('description')}
              >
                Description
              </DropdownMenuItem>
              <DropdownMenuItem
                checkStyle="check"
                checked={cols.category}
                onSelect={() => toggle('category')}
              >
                Category
              </DropdownMenuItem>
              <DropdownMenuItem
                checkStyle="check"
                checked={cols.amount}
                onSelect={() => toggle('amount')}
              >
                Amount
              </DropdownMenuItem>
              <DropdownMenuItem
                checkStyle="check"
                checked={cols.account}
                onSelect={() => toggle('account')}
              >
                Account
              </DropdownMenuItem>
              <DropdownMenuItem
                checkStyle="check"
                checked={cols.notes}
                onSelect={() => toggle('notes')}
              >
                Notes
              </DropdownMenuItem>
              <DropdownMenuItem
                checkStyle="check"
                checked={cols.tags}
                onSelect={() => toggle('tags')}
              >
                Tags
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <span className={s.ann}>column visibility toggles</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Nested – 2 levels ─── */

export function NestedTwoLevelDemo() {
  const [tags, setTags] = useState({
    recurring: true,
    tax: false,
    business: false,
    personal: false,
    reimbursable: false,
  });
  const toggleTag = (key: keyof typeof tags) => setTags((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className={s.section}>
      <div className={s.sectionLabel}>Nested – 2 levels</div>
      <div className={s.row}>
        <div className={s.col}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={`${btn.btnBase} ${btn.btnMd} ${btn.btnSecondary}`}>
                <MoreHorizontal size={14} /> Actions <ChevronDown size={12} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem icon={<Pencil size={14} />} shortcut="⌘E" onSelect={noop}>
                Edit transaction
              </DropdownMenuItem>
              <DropdownMenuItem icon={<Copy size={14} />} onSelect={noop}>
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />

              {/* Move to category submenu */}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger icon={<Folder size={14} />}>
                  Move to category
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuLabel>Spending</DropdownMenuLabel>
                  <DropdownMenuItem icon={<Utensils size={14} />} onSelect={noop}>
                    Food &amp; Dining
                  </DropdownMenuItem>
                  <DropdownMenuItem icon={<Car size={14} />} onSelect={noop}>
                    Transport
                  </DropdownMenuItem>
                  <DropdownMenuItem icon={<Home size={14} />} onSelect={noop}>
                    Housing
                  </DropdownMenuItem>
                  <DropdownMenuItem icon={<Zap size={14} />} onSelect={noop}>
                    Utilities
                  </DropdownMenuItem>
                  <DropdownMenuItem icon={<Tv size={14} />} onSelect={noop}>
                    Entertainment
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Income</DropdownMenuLabel>
                  <DropdownMenuItem icon={<Banknote size={14} />} onSelect={noop}>
                    Salary
                  </DropdownMenuItem>
                  <DropdownMenuItem icon={<Briefcase size={14} />} onSelect={noop}>
                    Freelance
                  </DropdownMenuItem>
                  <DropdownMenuItem icon={<TrendingUp size={14} />} onSelect={noop}>
                    Investment
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              {/* Add tag submenu */}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger icon={<Tag size={14} />}>Add tag</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem
                    icon={<Repeat size={14} />}
                    checkStyle="check"
                    checked={tags.recurring}
                    onSelect={() => toggleTag('recurring')}
                  >
                    Recurring
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    icon={<Receipt size={14} />}
                    checkStyle="check"
                    checked={tags.tax}
                    onSelect={() => toggleTag('tax')}
                  >
                    Tax deductible
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    icon={<Building2 size={14} />}
                    checkStyle="check"
                    checked={tags.business}
                    onSelect={() => toggleTag('business')}
                  >
                    Business
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    icon={<User size={14} />}
                    checkStyle="check"
                    checked={tags.personal}
                    onSelect={() => toggleTag('personal')}
                  >
                    Personal
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    icon={<HandCoins size={14} />}
                    checkStyle="check"
                    checked={tags.reimbursable}
                    onSelect={() => toggleTag('reimbursable')}
                  >
                    Reimbursable
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              {/* Export as submenu */}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger icon={<Download size={14} />}>
                  Export as
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onSelect={noop}>CSV spreadsheet</DropdownMenuItem>
                  <DropdownMenuItem onSelect={noop}>PDF statement</DropdownMenuItem>
                  <DropdownMenuItem onSelect={noop}>Excel (.xlsx)</DropdownMenuItem>
                  <DropdownMenuItem onSelect={noop}>OFX / QFX</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSeparator />
              <DropdownMenuItem icon={<Archive size={14} />} onSelect={noop}>
                Archive
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem icon={<Trash2 size={14} />} variant="danger" onSelect={noop}>
                Delete transaction
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <span className={s.ann}>secondary trigger · 2-level nesting</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Deep nested – 3 levels ─── */

export function DeepNestedDemo() {
  const [schedule, setSchedule] = useState('weekly');

  return (
    <div className={s.section}>
      <div className={s.sectionLabel}>Deep nested – 3 levels</div>
      <div className={s.row}>
        <div className={s.col}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={`${btn.btnBase} ${btn.btnMd} ${btn.btnTrueGhost}`}>
                Report options <ChevronDown size={12} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem icon={<BarChart2 size={14} />} onSelect={noop}>
                View report
              </DropdownMenuItem>

              {/* Share → Email to (3 levels) */}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger icon={<Share2 size={14} />}>Share</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem icon={<Link size={14} />} shortcut="⌘⇧C" onSelect={noop}>
                    Copy link
                  </DropdownMenuItem>

                  {/* Level 3: Email to */}
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger icon={<Mail size={14} />}>
                      Email to
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuLabel>Recent</DropdownMenuLabel>
                      <DropdownMenuItem onSelect={noop}>alex@example.com</DropdownMenuItem>
                      <DropdownMenuItem onSelect={noop}>sam@example.com</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem icon={<Plus size={14} />} onSelect={noop}>
                        New recipient…
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>

                  <DropdownMenuItem icon={<MessageSquare size={14} />} onSelect={noop}>
                    Send via Slack
                  </DropdownMenuItem>
                  <DropdownMenuItem icon={<Code2 size={14} />} onSelect={noop}>
                    Embed
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              {/* Schedule submenu */}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger icon={<CalendarClock size={14} />}>
                  Schedule
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem
                    checked={schedule === 'daily'}
                    onSelect={() => setSchedule('daily')}
                  >
                    Daily
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    checked={schedule === 'weekly'}
                    onSelect={() => setSchedule('weekly')}
                  >
                    Weekly
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    checked={schedule === 'monthly'}
                    onSelect={() => setSchedule('monthly')}
                  >
                    Monthly
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    checked={schedule === 'quarterly'}
                    onSelect={() => setSchedule('quarterly')}
                  >
                    Quarterly
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    icon={<BellOff size={14} />}
                    onSelect={() => setSchedule('off')}
                  >
                    Turn off
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSeparator />
              <DropdownMenuItem icon={<Copy size={14} />} onSelect={noop}>
                Duplicate report
              </DropdownMenuItem>
              <DropdownMenuItem icon={<Trash2 size={14} />} variant="danger" onSelect={noop}>
                Delete report
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <span className={s.ann}>3-level depth</span>
        </div>
      </div>
    </div>
  );
}
