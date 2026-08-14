import { type ReactNode } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { IconButton } from './IconButton.js';
import * as sn from './sidenav.css.js';
import { Tooltip } from './Tooltip.js';

export interface NavItem {
  value: string;
  label: string;
  icon?: ReactNode;
  rightIcon?: ReactNode;
  section?: string;
  pinBottom?: boolean;
}

export interface SideNavProps {
  items: NavItem[];
  value: string;
  onChange: (value: string) => void;
  brandIcon?: ReactNode;
  /** Wordmark beside the icon. Pass `null` for a brand that is image-only. */
  brandLabel?: string | null;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  footer?: ReactNode;
  className?: string;
  itemActiveClassName?: string;
  itemIconActiveClassName?: string;
}

export function SideNav({
  items,
  value,
  onChange,
  brandIcon,
  brandLabel = 'Avoir',
  collapsed = false,
  onCollapsedChange,
  footer,
  className,
  itemActiveClassName,
  itemIconActiveClassName,
}: SideNavProps) {
  const mainItems = items.filter((i) => !i.pinBottom);
  const bottomItems = items.filter((i) => i.pinBottom);

  return (
    <nav
      className={[sn.sidebar, collapsed ? sn.sidebarCollapsed : '', className]
        .filter(Boolean)
        .join(' ')}
      aria-label="Main navigation"
    >
      {/* Centred when collapsed, and also when the brand is image-only: with no
          wordmark beside it the art is the whole row, so left-aligning it just
          parks it against one edge. */}
      <div className={`${sn.brand} ${collapsed || !brandLabel ? sn.brandCentered : ''}`}>
        {brandIcon && <span className={sn.brandIcon}>{brandIcon}</span>}
        {!collapsed && brandLabel && <span className={sn.brandText}>{brandLabel}</span>}
      </div>
      <div className={`${sn.navList} ${collapsed ? sn.navListCentered : ''}`} role="list">
        {collapsed
          ? mainItems.map((item) => {
              const isActive = item.value === value;
              const cls = [
                sn.navItemIcon,
                isActive ? sn.navItemIconActive : '',
                isActive && itemIconActiveClassName ? itemIconActiveClassName : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <div key={item.value} role="listitem">
                  <Tooltip content={item.label} side="right">
                    <button type="button" className={cls} onClick={() => onChange(item.value)}>
                      <span className={sn.iconWrap}>{item.icon}</span>
                    </button>
                  </Tooltip>
                </div>
              );
            })
          : (() => {
              const sections: { section: string | null; items: NavItem[] }[] = [];
              let cur: string | null = null;
              let grp: NavItem[] = [];
              for (const item of mainItems) {
                const sec = item.section ?? null;
                if (sec !== cur) {
                  if (grp.length) sections.push({ section: cur, items: grp });
                  cur = sec;
                  grp = [item];
                } else grp.push(item);
              }
              if (grp.length) sections.push({ section: cur, items: grp });
              return sections.map((sec, si) => (
                <div
                  key={sec.section ?? `section-${sec.items[0]?.value ?? si}`}
                  role="listitem"
                  style={{ display: 'flex', flexDirection: 'column', gap: 'inherit' }}
                >
                  {sec.section && <div className={sn.navSection}>{sec.section}</div>}
                  {sec.items.map((item) => {
                    const isActive = item.value === value;
                    const cls = [
                      sn.navItem,
                      isActive ? sn.navItemActive : '',
                      isActive && itemActiveClassName ? itemActiveClassName : '',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    return (
                      <button
                        key={item.value}
                        type="button"
                        className={cls}
                        onClick={() => onChange(item.value)}
                      >
                        {item.icon && <span className={sn.iconWrap}>{item.icon}</span>}
                        <span className={sn.labelWrap}>{item.label}</span>
                        {item.rightIcon && (
                          <span className={sn.rightIconWrap}>{item.rightIcon}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ));
            })()}
      </div>
      {footer && !collapsed && footer}
      {bottomItems.length > 0 && (
        <div className={`${sn.navBottom} ${collapsed ? sn.navBottomCentered : ''}`} role="list">
          {collapsed
            ? bottomItems.map((item) => {
                const isActive = item.value === value;
                const cls = [
                  sn.navItemIcon,
                  isActive ? sn.navItemIconActive : '',
                  isActive && itemIconActiveClassName ? itemIconActiveClassName : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <div key={item.value} role="listitem">
                    <Tooltip content={item.label} side="right">
                      <button type="button" className={cls} onClick={() => onChange(item.value)}>
                        <span className={sn.iconWrap}>{item.icon}</span>
                      </button>
                    </Tooltip>
                  </div>
                );
              })
            : bottomItems.map((item) => {
                const isActive = item.value === value;
                const cls = [
                  sn.navItem,
                  isActive ? sn.navItemActive : '',
                  isActive && itemActiveClassName ? itemActiveClassName : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <div key={item.value} role="listitem">
                    <button type="button" className={cls} onClick={() => onChange(item.value)}>
                      {item.icon && <span className={sn.iconWrap}>{item.icon}</span>}
                      <span className={sn.labelWrap}>{item.label}</span>
                      {item.rightIcon && <span className={sn.rightIconWrap}>{item.rightIcon}</span>}
                    </button>
                  </div>
                );
              })}
        </div>
      )}
      {onCollapsedChange && (
        <IconButton
          icon={collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          tooltip={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          tooltipSide="right"
          size="sm"
          /*
           * `trueGhost`, not `onDark`. `onDark` paints a fixed
           * `rgba(255,255,255,0.7)` — correct while the rail was permanently
           * dark, and invisible the moment a theme gave it a light ground: the
           * collapse control vanished into the cream. `trueGhost` reads
           * `textSecondary`, the same token the nav items beside it now use.
           */
          variant="trueGhost"
          className={sn.collapseBtn}
          onClick={() => onCollapsedChange(!collapsed)}
        />
      )}
    </nav>
  );
}

export function SideNavLayout({ children }: { children: ReactNode }) {
  return <div className={sn.layout}>{children}</div>;
}
export function SideNavContent({ children }: { children: ReactNode }) {
  return <div className={sn.content}>{children}</div>;
}
