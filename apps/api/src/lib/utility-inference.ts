/** Valid ServiceType values matching the Prisma ServiceType enum. */
export type ServiceType =
  | 'ELECTRIC'
  | 'GAS'
  | 'WATER'
  | 'GARBAGE'
  | 'SEWAGE'
  | 'INTERNET'
  | 'CELLULAR';

/**
 * Infer ServiceType from a legacy type name string (case-insensitive).
 *
 * Uses substring matching against known utility patterns.
 * Returns 'ELECTRIC' as the default for unrecognized names.
 */
export function inferServiceType(typeName: string): ServiceType {
  const lower = typeName.toLowerCase();
  if (lower.includes('electric')) return 'ELECTRIC';
  if (lower.includes('gas')) return 'GAS';
  if (lower.includes('water')) return 'WATER';
  if (lower.includes('garbage') || lower.includes('trash') || lower.includes('waste'))
    return 'GARBAGE';
  if (lower.includes('sewage') || lower.includes('sewer')) return 'SEWAGE';
  if (lower.includes('internet') || lower.includes('wifi') || lower.includes('broadband'))
    return 'INTERNET';
  if (
    lower.includes('cellular') ||
    lower.includes('cell') ||
    lower.includes('mobile') ||
    lower.includes('phone')
  )
    return 'CELLULAR';
  return 'ELECTRIC';
}
