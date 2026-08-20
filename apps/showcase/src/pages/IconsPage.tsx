import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import {
  LayoutDashboard,
  Wallet,
  BookOpen,
  AlignJustify,
  Briefcase,
  TrendingUp,
  DollarSign,
  CreditCard,
  Zap,
  Heart,
  Radio,
  Settings,
  Plus,
  X,
  Check,
  Pencil,
  Trash2,
  Search,
  Filter,
  Upload,
  Download,
  Copy,
  ExternalLink,
  MessageSquare,
  Info,
  AlertTriangle,
  XCircle,
  AlertCircle,
  ArrowRight,
  TrendingDown,
  Monitor,
  BarChart2,
  LineChart,
  PieChart,
  Calendar,
  Shield,
  Link2,
  Package,
  MoreVertical,
  MoreHorizontal,
  LogOut,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import * as s from '../showcase.css.js';

interface IconEntry {
  icon: LucideIcon;
  label: string;
}

const navIcons: IconEntry[] = [
  { icon: LayoutDashboard, label: 'Dashboard' },
  { icon: Wallet, label: 'Wallet' },
  { icon: BookOpen, label: 'BookOpen' },
  { icon: AlignJustify, label: 'Transactions' },
  { icon: Briefcase, label: 'Budgets' },
  { icon: TrendingUp, label: 'Income' },
  { icon: DollarSign, label: 'Investments' },
  { icon: CreditCard, label: 'Debts' },
  { icon: Zap, label: 'Utilities' },
  { icon: Heart, label: 'Health Ins.' },
  { icon: Radio, label: 'Recurring' },
  { icon: Settings, label: 'Settings' },
];

const actionIcons: IconEntry[] = [
  { icon: Plus, label: 'Plus' },
  { icon: X, label: 'X' },
  { icon: Check, label: 'Check' },
  { icon: Pencil, label: 'Pencil' },
  { icon: Trash2, label: 'Trash2' },
  { icon: Search, label: 'Search' },
  { icon: Filter, label: 'Filter' },
  { icon: Upload, label: 'Upload' },
  { icon: Download, label: 'Download' },
  { icon: Copy, label: 'Copy' },
  { icon: ExternalLink, label: 'ExtLink' },
  { icon: MessageSquare, label: 'Note' },
];

const statusIcons: IconEntry[] = [
  { icon: Info, label: 'Info' },
  { icon: AlertTriangle, label: 'Warning' },
  { icon: XCircle, label: 'XCircle' },
  { icon: AlertCircle, label: 'AlertCircle' },
  { icon: ArrowRight, label: 'ArrowRight' },
  { icon: TrendingUp, label: 'Gain' },
  { icon: TrendingDown, label: 'Loss' },
];

const dataIcons: IconEntry[] = [
  { icon: Monitor, label: 'Accounts' },
  { icon: DollarSign, label: 'Dollar' },
  { icon: BarChart2, label: 'BarChart2' },
  { icon: LineChart, label: 'LineChart' },
  { icon: PieChart, label: 'PieChart' },
  { icon: Calendar, label: 'Calendar' },
  { icon: Shield, label: 'Insurance' },
  { icon: Link2, label: 'Linked acc.' },
  { icon: Package, label: 'Holdings' },
  { icon: MoreVertical, label: 'MoreVert' },
  { icon: MoreHorizontal, label: 'MoreHoriz' },
  { icon: LogOut, label: 'LogOut' },
];

function IconGrid({ icons }: { icons: IconEntry[] }) {
  return (
    <div className={s.iconGrid}>
      {icons.map(({ icon: Icon, label }) => (
        <div key={label} className={s.iconCell}>
          <Icon size={20} style={{ color: vars.color.textSecondary }} />
          <span className={s.iconName}>{label}</span>
        </div>
      ))}
    </div>
  );
}

export default function IconsPage() {
  return (
    <>
      {/* ── Section 1: Header ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Icon system – Lucide · 2px stroke · MIT license</div>
        <div className={s.ann}>
          pnpm add lucide-react · import {'{'} IconName {'}'} from 'lucide-react' · use size prop
          for sizing
        </div>
      </div>

      {/* ── Section 2: Icon grid ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Icon inventory</div>

        <div className={s.iconGroupLabel}>Navigation</div>
        <IconGrid icons={navIcons} />

        <div className={s.iconGroupLabel}>Actions</div>
        <IconGrid icons={actionIcons} />

        <div className={s.iconGroupLabel}>Status &amp; feedback</div>
        <IconGrid icons={statusIcons} />

        <div className={s.iconGroupLabel}>Data &amp; finance</div>
        <IconGrid icons={dataIcons} />
      </div>

      {/* ── Section 3: Icon sizes ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Icon sizes</div>
        <div>
          <div className={s.sizeRow}>
            <div className={s.sizeDemo}>
              <Plus size={12} style={{ color: vars.color.textSecondary }} />
              <span className={s.sizeLabel}>12px</span>
            </div>
            <span className={s.sizeSpec}>0.75rem – size-xs</span>
            <span className={s.sizeUsage}>badges, pills, tight inline</span>
          </div>
          <div className={s.sizeRow}>
            <div className={s.sizeDemo}>
              <Plus size={14} style={{ color: vars.color.textSecondary }} />
              <span className={s.sizeLabel}>14px</span>
            </div>
            <span className={s.sizeSpec}>0.875rem – size-sm</span>
            <span className={s.sizeUsage}>button icons, input adornments, table row actions</span>
          </div>
          <div className={s.sizeRow}>
            <div className={s.sizeDemo}>
              <Plus size={16} style={{ color: vars.color.textSecondary }} />
              <span className={s.sizeLabel}>16px</span>
            </div>
            <span className={s.sizeSpec}>1rem – size-md</span>
            <span className={s.sizeUsage}>card action buttons, form field icons</span>
          </div>
          <div className={s.sizeRow}>
            <div className={s.sizeDemo}>
              <Plus size={20} style={{ color: vars.color.textSecondary }} />
              <span className={s.sizeLabel}>20px</span>
            </div>
            <span className={s.sizeSpec}>1.25rem – size-lg</span>
            <span className={s.sizeUsage}>sidebar nav icons, page header actions</span>
          </div>
          <div className={s.sizeRow}>
            <div className={s.sizeDemo}>
              <Plus size={24} style={{ color: vars.color.textSecondary }} />
              <span className={s.sizeLabel}>24px</span>
            </div>
            <span className={s.sizeSpec}>1.5rem – size-xl</span>
            <span className={s.sizeUsage}>empty state icons, onboarding</span>
          </div>
        </div>
      </div>

      {/* ── Section 4: Icon color usage ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Icon color usage</div>
        <div>
          <div className={s.colorRow}>
            <div className={s.colorSwatch} style={{ background: vars.color.surfaceRaised }}>
              <Settings size={16} style={{ color: vars.color.textPrimary }} />
            </div>
            <div className={s.colorInfo}>
              <div className={s.colorName}>text-primary on surfaceRaised</div>
              <div className={s.colorDesc}>active state, selected, high-emphasis</div>
            </div>
          </div>
          <div className={s.colorRow}>
            <div className={s.colorSwatch} style={{ background: vars.color.surfaceRaised }}>
              <Settings size={16} style={{ color: vars.color.textSecondary }} />
            </div>
            <div className={s.colorInfo}>
              <div className={s.colorName}>text-secondary on surfaceRaised</div>
              <div className={s.colorDesc}>default resting state for most UI icons</div>
            </div>
          </div>
          <div className={s.colorRow}>
            <div className={s.colorSwatch} style={{ background: vars.color.surfaceRaised }}>
              <Settings size={16} style={{ color: vars.color.textTertiary }} />
            </div>
            <div className={s.colorInfo}>
              <div className={s.colorName}>text-tertiary on surfaceRaised</div>
              <div className={s.colorDesc}>placeholder, disabled, decorative</div>
            </div>
          </div>
          <div className={s.colorRow}>
            <div className={s.colorSwatch} style={{ background: vars.color.brand50 }}>
              <LayoutDashboard size={16} style={{ color: vars.color.brand600 }} />
            </div>
            <div className={s.colorInfo}>
              <div className={s.colorName}>brand-600 on brand-50</div>
              <div className={s.colorDesc}>brand accent icons, active nav</div>
            </div>
          </div>
          <div className={s.colorRow}>
            <div className={s.colorSwatch} style={{ background: vars.color.success50 }}>
              <TrendingUp size={16} style={{ color: vars.color.success400 }} />
            </div>
            <div className={s.colorInfo}>
              <div className={s.colorName}>success-400 on success-50</div>
              <div className={s.colorDesc}>gain / positive trend</div>
            </div>
          </div>
          <div className={s.colorRow}>
            <div className={s.colorSwatch} style={{ background: vars.color.danger50 }}>
              <TrendingDown size={16} style={{ color: vars.color.danger400 }} />
            </div>
            <div className={s.colorInfo}>
              <div className={s.colorName}>danger-400 on danger-50</div>
              <div className={s.colorDesc}>loss / negative trend</div>
            </div>
          </div>
          <div className={s.colorRow}>
            <div className={s.colorSwatch} style={{ background: vars.color.warning50 }}>
              <AlertTriangle size={16} style={{ color: vars.color.warning400 }} />
            </div>
            <div className={s.colorInfo}>
              <div className={s.colorName}>warning-400 on warning-50</div>
              <div className={s.colorDesc}>warnings, due dates</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Section 5: Icon + text patterns ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Icon + text patterns</div>
        <div>
          <div className={s.patternRow}>
            <span className={s.patternLabel}>trend-positive</span>
            <TrendingUp size={16} style={{ color: vars.color.success400 }} />
            <span style={{ color: vars.color.success700, fontWeight: vars.font.medium }}>
              +$1,042.37
            </span>
          </div>
          <div className={s.patternRow}>
            <span className={s.patternLabel}>trend-negative</span>
            <TrendingDown size={16} style={{ color: vars.color.danger400 }} />
            <span style={{ color: vars.color.danger400, fontWeight: vars.font.medium }}>
              –$146.86
            </span>
          </div>
          <div className={s.patternRow}>
            <span className={s.patternLabel}>date-label</span>
            <Calendar size={16} style={{ color: vars.color.textSecondary }} />
            <span style={{ color: vars.color.textSecondary }}>Due Apr 18, 2026</span>
          </div>
          <div className={s.patternRow}>
            <span className={s.patternLabel}>warning-inline</span>
            <AlertTriangle size={16} style={{ color: vars.color.warning400 }} />
            <span style={{ color: vars.color.warning700, fontWeight: vars.font.medium }}>
              Payment overdue by 3 days
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
