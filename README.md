# Nuxt-Extend-SMS — SIS Module / 学校信息模块

> This repository now hosts the **SIS module** (`sis-demo`) extracted from the main
> `Nuxt-Admin` repository. The previous SMS implementation remains available in
> this repository's git history.

An independent Nuxt 4 layer + Module SDK module for school information management:

- academic years, terms, grades and subjects
- teachers, classes, students and guardians
- enrollments with history (withdraw keeps the old row)
- role-aware scopes: admin / teacher / student / guardian
- canonical permissions (`sis.<resource>.<action>`), organization isolation and audit attribution

## Install into the host

```bash
git clone https://github.com/FrankOldmoon/Nuxt-Extend-SMS.git <host>/modules/sis-demo
```

Register it in the host `modules.catalog.ts`:

```ts
import { exampleModule } from './modules/example/module'
import { sisDemoModule } from './modules/sis-demo/module'

export const MODULE_DEFINITIONS = [exampleModule, sisDemoModule]
export const DEFAULT_ENABLED_MODULE_IDS = ['example', 'sis-demo']
```

Build and migrate:

```bash
ENABLED_MODULES=example,sis-demo pnpm build
pnpm db:migrate:release
```

The module owns its tables (`sis_*`) through module migrations. Uninstalling it
never drops business data.

## Contract

The module only imports platform contracts from `server/sdk`; it must not import
`server/core/**` or `server/utils/**` from the host. The host's
`test/unit/server/core/moduleDecoupling.test.ts` enforces this boundary.

## Tests

The module tests live in `test/` and run through the host Vitest setup once the
repository is cloned to `modules/sis-demo`:

```bash
pnpm test
```
