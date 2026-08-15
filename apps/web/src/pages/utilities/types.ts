/** Local types used only by the Utilities page and its sub-components. */

export interface Provider {
  id: string;
  name: string;
  /**
   * What this provider supplies, distinct and sorted. Drives the nav icon.
   *
   * Optional because an older server will not send it — the page falls back to
   * a generic mark rather than failing to render.
   */
  serviceTypes?: string[];
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface Service {
  id: string;
  providerId: string;
  serviceType: string;
  metering: string;
  expenseId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface Reading {
  id: string;
  serviceId: string;
  billDate: Date | string;
  dueDate: Date | string | null;
  usage: number | null;
  cost: number;
  unitCost: number | null;
  convenienceFee: number | null;
  convenienceFeeType: string | null;
  otherFees: number | null;
  details: Record<string, unknown> | null;
  createdAt: Date | string;
}

export interface Expense {
  id: string;
  name: string;
}

/** Compute total bill: cost + convenienceFee (dollar or percent) + otherFees */
export function totalBill(r: Reading): number {
  const fee = r.convenienceFee ?? 0;
  const other = r.otherFees ?? 0;
  const convenienceAmount = r.convenienceFeeType === 'percent' ? (r.cost * fee) / 100 : fee;
  return r.cost + convenienceAmount + other;
}

/** Convert a Date or ISO string to YYYY-MM-DD */
export function toDateString(d: Date | string): string {
  if (d instanceof Date) return d.toISOString().split('T')[0]!;
  return d.split('T')[0]!;
}

/** Format a service type for display: ELECTRIC → Electric */
export function formatServiceType(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
}

export const SERVICE_TYPE_OPTIONS = [
  { value: 'ELECTRIC', label: 'Electric' },
  { value: 'GAS', label: 'Gas' },
  { value: 'WATER', label: 'Water' },
  { value: 'GARBAGE', label: 'Garbage' },
  { value: 'SEWAGE', label: 'Sewage' },
  { value: 'INTERNET', label: 'Internet' },
  { value: 'CELLULAR', label: 'Cellular' },
];
