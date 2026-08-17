# Avoir Money

A personal finance management application for tracking income, expenses, transactions, investments, debts, and utilities.

> **This repository is where active development continues.** It began as a full-history clone of `budget-tracker`, which is now **frozen at `v0.8-final`** and kept runnable as the working application. Every one of its 797 commits came across deliberately: the reasoning behind the ledger — the balance chain, the single-gate architecture, the NULL-cascade repair, the two-writers bug (ADR-013/014/018/027/028) — lives in that history, and it is the specification the Rust implementation has to reproduce. `git log -S` is expected to be open in another window during the port.
>
> **The app here still runs today.** The TypeScript backend is deliberately NOT deleted: it is the reference implementation the Rust port is diffed against, and that is the only thing that can answer "is the port correct" rather than "does the port respond". It goes when differential verification says it can.
>
> See `.kiro/docs/BACKLOG.md` for the plan.

An Electron desktop app over a Rust backend with an embedded SQLite database, plus the React SPA it has always used. The original TypeScript/Hono/Postgres stack is still present as the reference implementation.

**The shell was Tauri until 2026-08-10.** It used the system WebKitGTK, which made rendering a property of the host: on the development machine it would not start without disabling hardware rendering, and the design system is OKLCH-only where WebKitGTK's colour management is weakest. Electron bundles a pinned Chromium — the engine the design was built against — so what is tested is what ships. See ADR-036.

## Tech Stack

| Layer    | Technology                                             |
| -------- | ------------------------------------------------------ |
| Monorepo | Turborepo + pnpm workspaces                            |
| Language | TypeScript 5.8+                                        |
| Runtime  | Node 22 LTS                                            |
| API      | Hono + @hono/zod-openapi, port 5174                    |
| Frontend | React 19 + Vite 6, port 5173                           |
| Styling  | Vanilla Extract (Tailwind being retired)               |
| Forms    | react-hook-form 7 + Zod                                |
| State    | Zustand, TanStack React Query                          |
| Routing  | TanStack React Router                                  |
| Charts   | Recharts                                               |
| Icons    | lucide-react                                           |
| Database | PostgreSQL 16 (Docker)                                 |
| ORM      | Prisma 6                                               |
| Testing  | Vitest 4, fast-check (property-based), Testing Library |

## Monorepo Structure

```
budget-tracker/
├── apps/
│   ├── api/                  → @budget-tracker/api (Hono REST API)
│   ├── web/                  → @budget-tracker/web (React SPA)
│   └── showcase/             → design system component showcase
├── packages/
│   ├── core/                 → @budget-tracker/core (Zod schemas, shared types)
│   ├── db/                   → @budget-tracker/db (Prisma client, schema, migrations)
│   └── ui/                   → @budget-tracker/ui (design system)
├── scripts/                  → Migration and utility scripts
├── tools/
│   └── import/               → Spreadsheet import tooling
├── docker-compose.yml
├── turbo.json
└── package.json
```

## API Routes

All routes are under `/api/v1` and use `@hono/zod-openapi` for schema-validated request/response contracts.

| Route                     | Domain                                                           |
| ------------------------- | ---------------------------------------------------------------- |
| `/accounts`               | Bank, savings, credit card, and gift card accounts               |
| `/budgets`                | Budget items (formerly categories)                               |
| `/budget-links`           | Budget-expense linking                                           |
| `/category-budgets`       | Budget allocations within year plans                             |
| `/dashboard`              | Aggregated dashboard data                                        |
| `/debts`                  | Debt tracking with amortization (mortgage, auto, student, etc.)  |
| `/escrow`                 | Mortgage escrow tracking                                         |
| `/expenses`               | Recurring expenses with frequency scheduling                     |
| `/goals`                  | Savings and budget goals                                         |
| `/healthcare`             | Healthcare deductible and out-of-pocket tracking                 |
| `/income`                 | Income sources with frequency scheduling                         |
| `/investments`            | Holdings, snapshots, custodians, wallets, trade/transfer history |
| `/pay-periods`            | Pay period generation and management                             |
| `/pay-schedules`          | Pay schedule configuration                                       |
| `/scheduled-transactions` | Scheduled transaction management (mark-as-paid, snooze, skip)    |
| `/sign-conventions`       | Sign convention settings                                         |
| `/transactions`           | All transactions (expense, income, transfer, refund, trade)      |
| `/utilities`              | Utility bill tracking (electric, gas, water, etc.)               |
| `/year-plans`             | Year plan management                                             |

## Frontend Pages

| Route           | Page         | Description                                                            |
| --------------- | ------------ | ---------------------------------------------------------------------- |
| `/`             | Dashboard    | Financial overview with charts and summaries                           |
| `/income`       | Income       | Manage recurring income sources                                        |
| `/recurring`    | Expenses     | Manage recurring expenses                                              |
| `/transactions` | Transactions | Full transaction ledger with add/edit/delete, bitcoin payments, trades |
| `/accounts`     | Accounts     | Bank and investment account management                                 |
| `/utilities`    | Utilities    | Utility bill tracking with usage and cost history                      |
| `/healthcare`   | Healthcare   | Annual deductible and out-of-pocket tracking                           |
| `/investments`  | Investments  | Holdings, trade history, transfers, snapshots                          |
| `/budgets`      | Budgets      | Budget group and budget item management                                |
| `/debts`        | Debts        | Debt tracking with amortization and payment history                    |
| `/settings`     | Settings     | App configuration                                                      |

## Data Model

### Core Entities

- **Account** — Bank accounts, credit cards, gift cards with balance tracking and optional rewards
- **BudgetGroup / Budget** — Hierarchical transaction categorization (renamed from CategoryGroup/Category)
- **Transaction** — All financial events (expense, income, transfer, refund, trade) with optional bitcoin/trade metadata and parent-child splitting
- **Income** — Recurring income sources with frequency, scheduling, pause/archive support
- **Expense** — Recurring expenses with frequency, due day/weekday rules, pause/archive support

### Investments

- **InvestmentHolding** — Stock and Bitcoin holdings with quantity and cost basis
- **InvestmentSnapshot** — Point-in-time holding valuations
- **InvestmentTransfer** — Audit log for transfers between wallets/custodians
- **Custodian** — Brokerage/custodian entities (Fidelity, etc.)
- **Wallet** — Bitcoin wallets with custody type (custodial/non-custodial) and storage type (hot/cold)

### Financial Planning

- **PaySchedule / PayPeriod** — Configurable pay schedules (weekly, biweekly, semi-monthly, monthly) with generated periods
- **BalanceSnapshot** — Per-period account balance snapshots
- **BudgetGoal** — Savings, debt payoff, investment, and spending limit goals
- **Debt / DebtPayment** — Debt tracking with APR, amortization, and payment history linked to transactions

### Utilities & Healthcare

- **UtilityProvider** — Utility companies that supply services (e.g., Metro Power, AT&T)
- **UtilityService** — Categorized services under a provider (Electric, Gas, Water, etc.) with metering classification and optional expense linking
- **UtilityReading** — Utility bill records with usage, cost, and fee breakdowns
- **HealthcareYear** — Annual healthcare deductible and out-of-pocket tracking

### Scheduling

- **ScheduledTransaction** — Lazily generated scheduled transactions with mark-as-paid, snooze, and skip support

## Key Features

- **Bitcoin support** — Bitcoin payment method for transactions with wallet tracking, sats/BTC unit conversion, bidirectional USD/BTC entry, and automatic holding adjustments
- **Trade tracking** — Buy/sell trades for stocks and Bitcoin with holding quantity and cost basis management
- **Investment history** — Unified timeline of trades, transfers, and bitcoin payments with cursor-based pagination
- **Scheduled transactions** — Lazily generated from recurring expenses/income with mark-as-paid, snooze, and skip support
- **Transaction splitting** — Parent-child transaction relationships with tax field support
- **Debt amortization** — Automatic principal/interest splitting for debt-linked transactions
- **Pay period management** — Configurable pay schedules with automatic period generation
- **Utility tracking** — Detailed utility bill tracking with usage metrics and cost analysis
- **Healthcare tracking** — Annual deductible and out-of-pocket maximum tracking
- **Import/export** — Spreadsheet data import tooling

## Databases

| Database              | Port | Purpose                                       |
| --------------------- | ---- | --------------------------------------------- |
| `budget_tracker`      | 5432 | Production — real financial data              |
| `budget_tracker_test` | 5433 | Test — disposable, truncated before each test |

Both run in Docker containers with credentials `budget:budget`.

## Common Commands

```bash
pnpm install          # Install dependencies
pnpm dev              # Start all dev servers
pnpm build            # Build all packages
pnpm typecheck        # Typecheck all packages
pnpm test             # Run all tests
docker compose up -d  # Start databases
docker compose down   # Stop databases
```
