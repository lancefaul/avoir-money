import * as inp from './inputs.css.js';

export interface SectionHeadingProps {
  children: React.ReactNode;
}

export function SectionHeading({ children }: SectionHeadingProps) {
  return <div className={inp.sectionHeading}>{children}</div>;
}
