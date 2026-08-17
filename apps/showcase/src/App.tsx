import { useState } from 'react';
import { lightTheme } from '@budget-tracker/ui/theme/theme-light.css.js';
import { darkTheme } from '@budget-tracker/ui/theme/theme-dark.css.js';
import { cipherpunkTheme } from '@budget-tracker/ui/theme/theme-cipherpunk.css.js';
import '@budget-tracker/ui/theme/globals.css.js';
import * as s from './showcase.css.js';
import {
  ShowcaseSettings,
  getInitialFont,
  FONT_UI_VAR,
  FONT_DISPLAY_VAR,
  FONT_LABEL_VAR,
  FONT_CODE_VAR,
} from './FontSwitcher.js';
import ButtonsPage from './pages/ButtonsPage.js';
import IconsPage from './pages/IconsPage.js';
import LinksPage from './pages/LinksPage.js';
import BadgesPage from './pages/BadgesPage.js';
import TagsPage from './pages/TagsPage.js';
import TooltipsPage from './pages/TooltipsPage.js';
import ToggletipsPage from './pages/ToggletipsPage.js';
import DropdownMenuPage from './pages/DropdownMenuPage.js';
import FormInputsPage from './pages/FormInputsPage.js';
import SelectionPage from './pages/SelectionPage.js';
import TabsPage from './pages/TabsPage.js';
import ProgressPage from './pages/ProgressPage.js';
import ModalsPage from './pages/ModalsPage.js';
import ToastPage from './pages/ToastPage.js';
import ColorPage from './pages/ColorPage.js';
import TypographyPage from './pages/TypographyPage.js';
import SpacingPage from './pages/SpacingPage.js';
import RadiusPage from './pages/RadiusPage.js';
import ElevationPage from './pages/ElevationPage.js';
import ScrollbarsPage from './pages/ScrollbarsPage.js';
import SensitivePage from './pages/SensitivePage.js';
import StepIndicatorPage from './pages/StepIndicatorPage.js';
import LayoutComponentsPage from './pages/LayoutComponentsPage.js';
import {
  SideNav,
  SideNavLayout,
  SideNavContent,
  type NavItem,
  navItemActiveBrand,
  navItemIconActiveBrand,
  brandIconImage,
} from '@budget-tracker/ui';
import {
  Image,
  Link2,
  Award,
  Tag,
  MousePointerClick,
  MessageCircle,
  ChevronDown,
  TextCursorInput,
  ListFilter,
  ListOrdered,
  PanelTop,
  BarChart3,
  Layers,
  LayoutGrid,
  Settings,
  User,
  Bell,
  SwatchBook,
  Type,
  Ruler,
  Squircle,
  Box,
  MoveVertical,
  EyeOff,
} from 'lucide-react';

type ThemeId = 'light' | 'dark' | 'cipherpunk';

const themes = {
  light: { label: 'Light', className: lightTheme },
  dark: { label: 'Dark', className: darkTheme },
  cipherpunk: { label: 'Cipherpunk', className: cipherpunkTheme },
};

const navItems: NavItem[] = [
  { value: 'badges', label: 'Badges', icon: <Award size={16} /> },
  { value: 'buttons', label: 'Buttons', icon: <MousePointerClick size={16} /> },
  { value: 'color', label: 'Color', icon: <SwatchBook size={16} /> },
  { value: 'dropdown-menus', label: 'Dropdown Menus', icon: <ChevronDown size={16} /> },
  { value: 'elevation', label: 'Elevation', icon: <Box size={16} /> },
  { value: 'form-inputs', label: 'Form Inputs', icon: <TextCursorInput size={16} /> },
  { value: 'icons', label: 'Icons', icon: <Image size={16} /> },
  { value: 'layout', label: 'Layout', icon: <LayoutGrid size={16} /> },
  { value: 'links', label: 'Links', icon: <Link2 size={16} /> },
  { value: 'modals', label: 'Modals', icon: <Layers size={16} /> },
  { value: 'progress', label: 'Progress', icon: <BarChart3 size={16} /> },
  { value: 'radius', label: 'Radius', icon: <Squircle size={16} /> },
  { value: 'scrollbars', label: 'Scrollbars', icon: <MoveVertical size={16} /> },
  { value: 'sensitive', label: 'Sensitive', icon: <EyeOff size={16} /> },
  { value: 'selection', label: 'Selection', icon: <ListFilter size={16} /> },
  { value: 'spacing', label: 'Spacing', icon: <Ruler size={16} /> },
  { value: 'step-indicator', label: 'Step Indicator', icon: <ListOrdered size={16} /> },
  { value: 'tabs', label: 'Tabs', icon: <PanelTop size={16} /> },
  { value: 'tags', label: 'Tags', icon: <Tag size={16} /> },
  { value: 'toasts', label: 'Toasts', icon: <Bell size={16} /> },
  { value: 'toggletips', label: 'Toggletips', icon: <MessageCircle size={16} /> },
  { value: 'tooltips', label: 'Tooltips', icon: <MessageCircle size={16} /> },
  { value: 'typography', label: 'Typography', icon: <Type size={16} /> },
  { value: 'settings', label: 'Settings', icon: <Settings size={16} />, pinBottom: true },
  { value: 'user', label: 'User', icon: <User size={16} />, pinBottom: true },
];

export default function App() {
  const [theme, setTheme] = useState<ThemeId>('light');
  const [page, setPage] = useState('typography');
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [uiFont, setUiFont] = useState(() => getInitialFont('ui'));
  const [displayFont, setDisplayFont] = useState(() => getInitialFont('display'));
  const [labelFont, setLabelFont] = useState(() => getInitialFont('label'));
  const [codeFont, setCodeFont] = useState(() => getInitialFont('code'));

  const pageLabel = navItems.find((n) => n.value === page)?.label ?? 'Typography';

  const brandIcon = <img src="/avoir-icon-rounded.svg" alt="" className={brandIconImage} />;

  return (
    <div
      className={`${themes[theme].className} ${s.themeWrap}`}
      style={
        {
          [FONT_UI_VAR]: uiFont,
          [FONT_DISPLAY_VAR]: displayFont,
          [FONT_LABEL_VAR]: labelFont,
          [FONT_CODE_VAR]: codeFont,
        } as React.CSSProperties
      }
    >
      <div id="tooltip-portal" />
      <SideNavLayout>
        <SideNav
          items={navItems}
          value={page}
          onChange={setPage}
          brandIcon={brandIcon}
          brandLabel="Design System"
          collapsed={navCollapsed}
          onCollapsedChange={setNavCollapsed}
          itemActiveClassName={theme === 'cipherpunk' ? navItemActiveBrand : undefined}
          itemIconActiveClassName={theme === 'cipherpunk' ? navItemIconActiveBrand : undefined}
        />
        <SideNavContent>
          <div className={s.page}>
            {/* ── Settings ── */}
            <div className={s.themeToggleWrap}>
              <ShowcaseSettings
                theme={theme}
                onThemeChange={setTheme}
                uiFont={uiFont}
                onUiFontChange={setUiFont}
                displayFont={displayFont}
                onDisplayFontChange={setDisplayFont}
                labelFont={labelFont}
                onLabelFontChange={setLabelFont}
                codeFont={codeFont}
                onCodeFontChange={setCodeFont}
              />
            </div>

            {/* ── Page title ── */}
            <h1 className={s.pageTitle}>Avoir Money Design System</h1>

            <h2 className={s.pageSubtitle}>{pageLabel}</h2>

            {page === 'tags' ? (
              <TagsPage />
            ) : page === 'badges' ? (
              <BadgesPage />
            ) : page === 'buttons' ? (
              <ButtonsPage />
            ) : page === 'tooltips' ? (
              <TooltipsPage />
            ) : page === 'toggletips' ? (
              <ToggletipsPage />
            ) : page === 'dropdown-menus' ? (
              <DropdownMenuPage />
            ) : page === 'form-inputs' ? (
              <FormInputsPage />
            ) : page === 'selection' ? (
              <SelectionPage />
            ) : page === 'tabs' ? (
              <TabsPage />
            ) : page === 'progress' ? (
              <ProgressPage />
            ) : page === 'modals' ? (
              <ModalsPage />
            ) : page === 'toasts' ? (
              <ToastPage />
            ) : page === 'color' ? (
              <ColorPage />
            ) : page === 'step-indicator' ? (
              <StepIndicatorPage />
            ) : page === 'layout' ? (
              <LayoutComponentsPage />
            ) : page === 'links' ? (
              <LinksPage />
            ) : page === 'icons' ? (
              <IconsPage />
            ) : page === 'spacing' ? (
              <SpacingPage />
            ) : page === 'radius' ? (
              <RadiusPage />
            ) : page === 'elevation' ? (
              <ElevationPage />
            ) : page === 'sensitive' ? (
              <SensitivePage />
            ) : page === 'scrollbars' ? (
              <ScrollbarsPage />
            ) : (
              <TypographyPage theme={theme} />
            )}
          </div>
        </SideNavContent>
      </SideNavLayout>
    </div>
  );
}
