# Avoir Money

Personal finance, self-hosted. Tracks income, recurring expenses, transactions,
investments, debts, healthcare deductibles and utilities — as a desktop
application that runs entirely on your own machine, with no account, no server
and no telemetry.

**Copyright © 2026 lancefaul. All rights reserved.**

This repository has no licence. That is deliberate and it is not the same as
public domain: the source is published to be read, and no permission to copy,
modify or redistribute it is granted. If you want to do something with it, ask.

---

## What it is

A single-user finance application. Your data lives in a SQLite file on your
disk; nothing leaves the machine unless you export it, and the only outbound
requests the app can make are optional price lookups you configure yourself with
your own API keys.

The architecture is a **Rust backend** serving both a JSON API and the built
frontend over `127.0.0.1` on an OS-assigned port, wrapped in an **Electron**
shell that spawns it as a child process and opens a window against it. The
frontend is a **React** SPA. Because the shell serves the page from the backend,
the browser and the desktop run identical client code — there is one transport,
not two.

## Layout

```
rust/           the backend: API, database, migrations, business logic
  api/          HTTP handlers and the transaction lifecycle
  core/         pure domain logic — money, dates, schedules, amortisation
  db/           SQLite schema, migrations, queries
  server/       the binary the desktop shell spawns
apps/web/       the React frontend
apps/api/       the ORIGINAL TypeScript backend — see below
apps/showcase/  design-system component gallery
packages/core/  shared Zod schemas and types
packages/ui/    the design system (Vanilla Extract)
electron/       the desktop shell, updater and preload bridge
spikes/         measured experiments behind several design decisions
```

### Why there are two backends

`apps/api` is a complete TypeScript/Hono/Postgres implementation of the same
API. It is **not dead code and not live code** — it is the reference the Rust
port is checked against.

The port was verified by running both implementations over the same data and
diffing every response, which is the only thing that can answer *is this
correct* rather than *does this respond*. That harness found 22 defects the
Rust test suite did not, including a transaction accepted into the ledger with
no amount. The reference is kept because regenerating those answers needs two
independent implementations; delete one and the fixtures stop meaning "what both
agreed" and start meaning "what this one did last time anyone looked".

It is not shipped in the desktop application.

## A note on money

Money is stored as **integer cents**, never as a float or a decimal string.
Quantities and unit prices — share counts, BTC amounts, per-unit utility rates —
are exact decimals, because a Bitcoin balance needs more than two places and
cents would flatten it to zero.

The ledger holds one invariant everywhere:

```
openingBalance + SUM(transactions) == balance
```

It is asserted in three deliberately independent restatements — a shell script
against live data, a property test, and a migration — so that a bug in one
cannot make the others agree with it.

## Building

Requires Node 22, pnpm and a Rust toolchain.

```sh
pnpm install
pnpm build                       # frontend and packages
cd rust && cargo build --release # backend
cd electron && pnpm dist         # desktop application
```

## Status

Version 1.0. It is used daily by its author, which is the only user acceptance
testing it has had.

Fixture data throughout — account names, tickers, merchants, people, amounts —
is invented. Real values were available and deliberately not used: a holdings
list, a merchant list or a bank statement is personal financial data, and the
names inside one belong to people who never agreed to appear here. What the
tests need is the SHAPE of a bank descriptor, not anyone's actual spending.
