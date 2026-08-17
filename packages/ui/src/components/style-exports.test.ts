import * as badgeStyles from './badges.css.js';
import * as buttonStyles from './buttons.css.js';
import * as inputStyles from './inputs.css.js';
import * as formControlStyles from './form-controls.css.js';
import * as selectStyles from './select.css.js';
import * as modalStyles from './modal.css.js';
import * as tooltipStyles from './tooltip.css.js';
import * as tabStyles from './tabs.css.js';
import * as dropdownMenuStyles from './dropdown-menu.css.js';
import * as buttonGroupStyles from './button-group.css.js';
import * as datepickerStyles from './datepicker.css.js';
import * as progressStyles from './progress.css.js';
import * as chipStyles from './chip.css.js';
import * as linkStyles from './links.css.js';
import * as toggletipStyles from './toggletip.css.js';
import * as popoverPanelStyles from './popover-panel.css.js';
import * as sidenavStyles from './sidenav.css.js';

/**
 * Validates: Requirements 14.1, 14.2, 14.3, 14.4
 *
 * These tests verify that CSS style modules export the expected class names
 * so consumers relying on these exports do not break when the DS is updated.
 */

describe('badgeStyles exports all expected class names', () => {
  const expectedKeys = [
    'badge',
    'badgePositive',
    'badgeNegative',
    'badgeWarning',
    'badgeInfo',
    'badgeNeutral',
    'badgeBrand',
    'badgeSm',
    'badgeLg',
    'badgeXl',
    'badgeIconOnly',
    'badgeDot',
    'badgeCount',
    'badgeCountSm',
    'badgeCountXs',
    'badgeCountLg',
    'badgeCountBrand',
    'badgeCountDanger',
    'badgeCountNeutral',
    'dotOnly',
    'dotBrand',
    'dotDanger',
    'iconBadgeWrap',
    'iconBadgeCount',
    'iconBadgeDot',
  ];

  it.each(expectedKeys)('exports "%s" as a string', (key) => {
    expect(badgeStyles).toHaveProperty(key);
    expect(typeof (badgeStyles as Record<string, unknown>)[key]).toBe('string');
  });
});

describe('buttonStyles exports all expected class names', () => {
  const expectedKeys = [
    'btnBase',
    'btnSm',
    'btnMd',
    'btnLg',
    'btnIconSm',
    'btnIconMd',
    'btnIconLg',
    'btnIconRoundSm',
    'btnPrimary',
    'btnSecondary',
    'btnTrueGhost',
    'btnDanger',
    'btnTrueGhostDanger',
    'btnTrueGhostBrand',
    'btnSuccess',
    'btnFailure',
    'btnContent',
    'btnContentHidden',
    'btnContentVisible',
    'spinner',
  ];

  it.each(expectedKeys)('exports "%s" as a string', (key) => {
    expect(buttonStyles).toHaveProperty(key);
    expect(typeof (buttonStyles as Record<string, unknown>)[key]).toBe('string');
  });
});

describe('other style modules each export at least one class name', () => {
  const modules: Record<string, Record<string, unknown>> = {
    inputStyles,
    formControlStyles,
    selectStyles,
    modalStyles,
    tooltipStyles,
    tabStyles,
    dropdownMenuStyles,
    buttonGroupStyles,
    datepickerStyles,
    progressStyles,
    chipStyles,
    linkStyles,
    toggletipStyles,
    popoverPanelStyles,
    sidenavStyles,
  };

  it.each(Object.entries(modules))('%s exports at least one class name', (_name, mod) => {
    const keys = Object.keys(mod);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(typeof mod[key]).toBe('string');
    }
  });
});

describe('all style modules from index.ts are importable with string-valued properties', () => {
  const allModules: Record<string, Record<string, unknown>> = {
    badgeStyles,
    buttonStyles,
    inputStyles,
    formControlStyles,
    selectStyles,
    modalStyles,
    tooltipStyles,
    tabStyles,
    dropdownMenuStyles,
    buttonGroupStyles,
    datepickerStyles,
    progressStyles,
    chipStyles,
    linkStyles,
    toggletipStyles,
    popoverPanelStyles,
    sidenavStyles,
  };

  it.each(Object.entries(allModules))(
    '%s resolves to an object with string-valued properties',
    (_name, mod) => {
      expect(typeof mod).toBe('object');
      expect(mod).not.toBeNull();
      const keys = Object.keys(mod);
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        expect(typeof mod[key]).toBe('string');
      }
    },
  );
});
