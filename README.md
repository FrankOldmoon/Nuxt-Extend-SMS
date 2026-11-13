# Nuxt-Extend-SMS — School Information Module

> This repository hosts the **SMS module** (`sms`) extracted from the `Nuxt-Admin` host.
> The previous SMS implementation remains available in this repository's git history.

A **Nuxt 4 layer + Module SDK** module for school information management. It is not a
standalone application: it mounts into `Nuxt-Admin` and runs inside the host Nitro process.

## Features

- Academic years, terms, grades and subjects
- Teachers, classes, students and guardians
- Enrollments with history (withdrawing keeps the old row)
- Role-aware scopes: admin / teacher / student / guardian
- Canonical permissions (`sms.<resource>.<action>`), organization isolation and audit attribution
- Tables use the `sms_` prefix and are created by module-owned migrations
- Uninstalling the module never drops business data

---

## Run with the Nuxt-Admin host

### 0. Prerequisites

- Node.js 20+
- pnpm 11
- PostgreSQL 14+

### 1. Clone and prepare the host

```bash
git clone https://github.com/FrankOldmoon/Nuxt-Admin.git
cd Nuxt-Admin

pnpm install
cp .env.example .env
# Edit .env and set at least:
# DATABASE_URL=postgres://postgres:postgres@localhost:5432/nuxt_ai
# SESSION_SECRET=<openssl rand -hex 32>
```

### 2. Clone this repository into `modules/sms`

The directory name **must be `sms`**, because the module ID is `sms` and the host
resolves each Nuxt layer as `./modules/<id>`:

```bash
# Still in the Nuxt-Admin root
git clone https://github.com/FrankOldmoon/Nuxt-Extend-SMS.git modules/sms

# The host is a pnpm workspace (pnpm-workspace.yaml covers modules/*).
# Re-run install so this module becomes a workspace package.
pnpm install
```

Do not clone it to a top-level `Nuxt-Extend-SMS/` directory. Do not run
`pnpm install` inside `modules/sms`; it is a workspace package and is installed
by the host.

### 3. Register the module in `modules.catalog.ts`

The host uses a **static catalog**, so the cloned module must be registered once:

```ts
// modules.catalog.ts
import { exampleModule } from './modules/example/module'
import { smsModule } from './modules/sms/module'

export const MODULE_DEFINITIONS = [exampleModule, smsModule]

// Optional: enable it by default (otherwise use ENABLED_MODULES)
export const DEFAULT_ENABLED_MODULE_IDS = ['example', 'sms']
```

If you only set `ENABLED_MODULES` without editing the catalog, startup fails with:

```text
Unknown enabled module: sms
```

### 4. Run migrations

```bash
# Base + module migrations (recommended for first run / deployment)
pnpm db:migrate:release
```

In development, the host boot plugin also applies base, module and blog
migrations automatically.

Module migrations create the `sms_*` tables and record `module_states = migrated`.

### 5. Start

```bash
pnpm dev
```

If `sms` is not in the default list:

```bash
ENABLED_MODULES=example,sms pnpm dev
```

### 6. Open

- School page: <http://localhost:3000/sms>
- Module management: <http://localhost:3000/dashboard/modules>
- Dashboard: <http://localhost:3000/dashboard>

Default administrator created by the host seed: `admin@example.com` / `Admin@123`.

---

## package.json and dependencies

This module has a `package.json` with metadata and `peerDependencies` (`nuxt`, `vue`).
The host workspace installs it, but that does **not** make this module a standalone app:

- it imports host contracts from `server/sdk` and host database/runtime services;
- its pages and Nitro handlers are compiled by the host;
- it has no own dev/build entry point.

Keep shared runtime dependencies (`nuxt`, `vue`, etc.) in `peerDependencies` to avoid
duplicate Vue/Nuxt instances. Module-specific dependencies can be declared in
`dependencies`; the host `pnpm install` installs them through the workspace.

---

## Database note

The module uses the `sms_*` table prefix. If a database previously ran the old SMS
module, it may already contain `sms_*` tables with a different schema. The new module
migrations use `CREATE TABLE IF NOT EXISTS`, so they will not alter those tables.

Use one of these options before running this module against such a database:

- use a fresh database;
- back up and drop/rename the old `sms_*` tables;
- or ask for a compatibility migration.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Unknown enabled module: sms` | `ENABLED_MODULES` set without editing `modules.catalog.ts` | Register `smsModule` as shown in step 3 |
| `/sms` returns 404 | Layer not enabled, or the clone directory is not `modules/sms` | Check `modules/sms/module.ts` and `ENABLED_MODULES` |
| Module API returns 403 | Module is not `active`, or the user has no organization membership/permission | Check `/dashboard/modules`; verify an active membership |
| `sms_*` tables are missing | Module migrations have not run | Run `pnpm db:migrate:release` or restart the dev server |
| Code changes are not visible | Nuxt layers are loaded at build time | Restart `pnpm dev`; rebuild for production |

> Disabling or uninstalling a module at `/dashboard/modules` only affects module APIs
> and lifecycle state. It does not unload compiled Nuxt pages; remove the module from
> `ENABLED_MODULES` and rebuild to remove its pages completely.

---

## Contract and tests

The module only imports platform contracts from the host `server/sdk`; it must not
import `server/core/**` or `server/utils/**`. The host test
`test/unit/server/core/moduleDecoupling.test.ts` enforces this boundary.

Module tests live in `test/` and are included by the host Vitest setup once this
repository is cloned to `modules/sms`:

```bash
# From the Nuxt-Admin root
pnpm test
```
