import {
  Pencil,
  Copy,
  Link2,
  Unlink,
  Trash2,
  Download,
  FileText,
  MoreHorizontal,
  ChevronDown,
  Settings,
  LogOut,
  User,
  Archive,
  Star,
  Sparkles,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  buttonStyles as btn,
} from '@budget-tracker/ui';
import * as s from '../showcase.css.js';
import {
  CheckedRadioDemo,
  CheckedCheckboxDemo,
  NestedTwoLevelDemo,
  DeepNestedDemo,
} from './DropdownMenuDemos.js';

const noop = () => {};

export default function DropdownMenuPage() {
  return (
    <>
      {/* ── Default icon trigger ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Default icon trigger</div>
        <div className={s.row}>
          <div className={s.col}>
            <DropdownMenu>
              <DropdownMenuTrigger />
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={noop}>Edit</DropdownMenuItem>
                <DropdownMenuItem onSelect={noop}>Duplicate</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="danger" onSelect={noop}>
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <span className={s.ann}>MoreVertical (default)</span>
          </div>
          <div className={s.col}>
            <DropdownMenu>
              <DropdownMenuTrigger>
                <MoreHorizontal size={14} />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={noop}>Edit</DropdownMenuItem>
                <DropdownMenuItem onSelect={noop}>Duplicate</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="danger" onSelect={noop}>
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <span className={s.ann}>MoreHorizontal</span>
          </div>
        </div>
      </div>

      {/* ── Custom button trigger (asChild) ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Custom button trigger – asChild</div>
        <div className={s.row}>
          <div className={s.col}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={`${btn.btnBase} ${btn.btnMd} ${btn.btnSecondary}`}>
                  Actions <ChevronDown size={12} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem icon={<Download size={14} />} onSelect={noop}>
                  Export CSV
                </DropdownMenuItem>
                <DropdownMenuItem icon={<FileText size={14} />} onSelect={noop}>
                  Export PDF
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem icon={<Archive size={14} />} onSelect={noop}>
                  Archive all
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <span className={s.ann}>Secondary + align start</span>
          </div>
          <div className={s.col}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={`${btn.btnBase} ${btn.btnMd} ${btn.btnPrimary}`}>
                  Add <ChevronDown size={12} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={noop}>Income</DropdownMenuItem>
                <DropdownMenuItem onSelect={noop}>Expense</DropdownMenuItem>
                <DropdownMenuItem onSelect={noop}>Transfer</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <span className={s.ann}>Primary + align start</span>
          </div>
        </div>
      </div>

      {/* ── Items with icons ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Items with icons</div>
        <div className={s.row}>
          <div className={s.col}>
            <DropdownMenu>
              <DropdownMenuTrigger />
              <DropdownMenuContent>
                <DropdownMenuItem icon={<Pencil size={14} />} onSelect={noop}>
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem icon={<Copy size={14} />} onSelect={noop}>
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem icon={<Link2 size={14} />} onSelect={noop}>
                  Link to budget
                </DropdownMenuItem>
                <DropdownMenuItem icon={<Unlink size={14} />} disabled>
                  Unlink
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem icon={<Trash2 size={14} />} variant="danger" onSelect={noop}>
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <span className={s.ann}>Full row-action menu</span>
          </div>
        </div>
      </div>

      {/* ── Keyboard shortcuts ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Keyboard shortcuts</div>
        <div className={s.row}>
          <div className={s.col}>
            <DropdownMenu>
              <DropdownMenuTrigger />
              <DropdownMenuContent>
                <DropdownMenuItem icon={<Pencil size={14} />} shortcut="⌘E" onSelect={noop}>
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem icon={<Copy size={14} />} shortcut="⌘D" onSelect={noop}>
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  icon={<Trash2 size={14} />}
                  variant="danger"
                  shortcut="⌘⌫"
                  onSelect={noop}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <span className={s.ann}>shortcut hints</span>
          </div>
        </div>
      </div>

      {/* ── Badges ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Badges</div>
        <div className={s.row}>
          <div className={s.col}>
            <DropdownMenu>
              <DropdownMenuTrigger />
              <DropdownMenuContent>
                <DropdownMenuItem icon={<Pencil size={14} />} onSelect={noop}>
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem icon={<Sparkles size={14} />} badge="New" onSelect={noop}>
                  AI Categorize
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem icon={<Archive size={14} />} onSelect={noop}>
                  Archive
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <span className={s.ann}>item with badge</span>
          </div>
        </div>
      </div>

      {/* ── Danger items ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Danger items</div>
        <div className={s.row}>
          <div className={s.col}>
            <DropdownMenu>
              <DropdownMenuTrigger />
              <DropdownMenuContent>
                <DropdownMenuItem icon={<Star size={14} />} onSelect={noop}>
                  Favorite
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem icon={<Trash2 size={14} />} variant="danger" onSelect={noop}>
                  Delete
                </DropdownMenuItem>
                <DropdownMenuItem icon={<Trash2 size={14} />} variant="danger" disabled>
                  Delete (disabled)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <span className={s.ann}>danger + danger disabled</span>
          </div>
        </div>
      </div>

      {/* ── Disabled items ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Disabled items – skipped in keyboard nav</div>
        <div className={s.row}>
          <div className={s.col}>
            <DropdownMenu>
              <DropdownMenuTrigger />
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={noop}>Enabled</DropdownMenuItem>
                <DropdownMenuItem disabled>Disabled</DropdownMenuItem>
                <DropdownMenuItem onSelect={noop}>Also enabled</DropdownMenuItem>
                <DropdownMenuItem disabled>Also disabled</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <span className={s.ann}>Arrow keys skip disabled</span>
          </div>
        </div>
      </div>

      {/* ── Separators & group labels ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Separators &amp; group labels</div>
        <div className={s.row}>
          <div className={s.col}>
            <DropdownMenu>
              <DropdownMenuTrigger />
              <DropdownMenuContent>
                <DropdownMenuLabel>Export</DropdownMenuLabel>
                <DropdownMenuItem icon={<FileText size={14} />} onSelect={noop}>
                  CSV
                </DropdownMenuItem>
                <DropdownMenuItem icon={<FileText size={14} />} onSelect={noop}>
                  PDF
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Account</DropdownMenuLabel>
                <DropdownMenuItem icon={<User size={14} />} onSelect={noop}>
                  Profile
                </DropdownMenuItem>
                <DropdownMenuItem icon={<Settings size={14} />} onSelect={noop}>
                  Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem icon={<LogOut size={14} />} variant="danger" onSelect={noop}>
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <span className={s.ann}>Labeled groups</span>
          </div>
        </div>
      </div>

      {/* ── Alignment: start vs end ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Alignment – start vs end</div>
        <div className={s.row} style={{ justifyContent: 'space-between', maxWidth: '24rem' }}>
          <div className={s.col}>
            <DropdownMenu>
              <DropdownMenuTrigger />
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={noop}>First item</DropdownMenuItem>
                <DropdownMenuItem onSelect={noop}>Second item</DropdownMenuItem>
                <DropdownMenuItem onSelect={noop}>Third item</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <span className={s.ann}>align=start</span>
          </div>
          <div className={s.col}>
            <DropdownMenu>
              <DropdownMenuTrigger />
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={noop}>First item</DropdownMenuItem>
                <DropdownMenuItem onSelect={noop}>Second item</DropdownMenuItem>
                <DropdownMenuItem onSelect={noop}>Third item</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <span className={s.ann}>align=end (default)</span>
          </div>
        </div>
      </div>

      <CheckedRadioDemo />
      <CheckedCheckboxDemo />
      <NestedTwoLevelDemo />
      <DeepNestedDemo />

      {/* ── Keyboard nav note ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Keyboard navigation</div>
        <div className={s.note}>
          Full keyboard support: ArrowUp/Down to navigate, Home/End to jump, Escape to close,
          Enter/Space to activate, Tab closes menu, type-ahead character search. Disabled items are
          skipped during arrow navigation. Submenus: ArrowRight opens, ArrowLeft/Escape closes
          current level only.
        </div>
      </div>
    </>
  );
}
