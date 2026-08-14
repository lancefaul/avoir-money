import { vars } from '../theme/contract.css.js';

type Size = 'sm' | 'md' | 'lg';
type Weight = 'regular' | 'medium' | 'semibold';

const sizeMap: Record<Size, string> = {
  sm: vars.font['2xl'],
  md: vars.font['3xl'],
  lg: vars.font['4xl'],
};

export interface DisplayHeadingProps {
  children: React.ReactNode;
  /** Heading size. @default 'md' */
  size?: Size;
  /**
   * Heading weight. @default 'regular'
   *
   * A prop rather than an inline override at the call site: the weight was
   * hardcoded here, so the app's title bar could only be made heavier by
   * reaching past the component with `style`, which DESIGN.md bans outright.
   */
  weight?: Weight;
  /** HTML element to render. @default 'h2' */
  as?: 'h1' | 'h2' | 'h3' | 'h4';
  /** Additional inline styles. */
  style?: React.CSSProperties;
}

export function DisplayHeading({
  children,
  size = 'md',
  weight = 'regular',
  as: Tag = 'h2',
  style,
}: DisplayHeadingProps) {
  return (
    <Tag
      style={{
        fontFamily: vars.font.display,
        fontSize: sizeMap[size],
        fontWeight: vars.font[weight],
        color: vars.color.textPrimary,
        margin: 0,
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}
