# Nuxt-Extend-SMS — SMS Module / 学校信息模块

> 本仓库现在托管从主仓库 `Nuxt-Admin` 抽出的 **SMS 模块**（模块 ID：`sms`）。
> 旧的 SMS 实现仍保留在本仓库的 Git 历史中。
>
> This repository hosts the **SMS module** (`sms`) extracted from `Nuxt-Admin`.
> The previous SMS implementation remains available in this repository's git history.

## 它是什么

一个**独立的 Nuxt 4 layer + Module SDK 模块**，不能单独运行，必须挂载到主项目 `Nuxt-Admin` 上：

- 学年、学期、年级、科目
- 教师、班级、学生、监护人
- 选课与退课历史（退课不删除记录）
- 角色范围：admin / teacher / student / guardian
- 规范权限 `sms.<resource>.<action>`、组织隔离、审计归属

表前缀为 `sms_`，由模块自己的迁移创建；卸载模块不会删除业务数据。

---

## 如何基于主仓库运行（完整步骤）

### 0. 前置条件

- Node.js 20+
- pnpm 11
- PostgreSQL 14+

### 1. 克隆并启动主仓库

```bash
git clone https://github.com/FrankOldmoon/Nuxt-Admin.git
cd Nuxt-Admin

pnpm install
cp .env.example .env
# 编辑 .env，至少设置：
# DATABASE_URL=postgres://postgres:postgres@localhost:5432/nuxt_ai
# SESSION_SECRET=<openssl rand -hex 32>
```

### 2. 把本仓库克隆到主仓库的 `modules/sms`

**目录名必须是 `sms`**，因为模块 ID 是 `sms`，主仓库按 `./modules/<id>` 解析 Nuxt layer：

```bash
# 仍在 Nuxt-Admin 根目录
git clone https://github.com/FrankOldmoon/Nuxt-Extend-SMS.git modules/sms
```

不要克隆到主仓库根目录下的 `Nuxt-Extend-SMS/`。模块虽然有自己的 `package.json`（元数据与 `peerDependencies`），但**不需要也不应该在模块目录单独 `pnpm install`**：它作为主项目的 Nuxt layer 运行在主项目进程内。

### 3. 在 `modules.catalog.ts` 注册模块

主仓库使用**静态 catalog**，克隆代码后必须登记一次：

```ts
// modules.catalog.ts
import { exampleModule } from './modules/example/module'
import { smsModule } from './modules/sms/module'

export const MODULE_DEFINITIONS = [exampleModule, smsModule]

// 可选：默认启用（否则用 ENABLED_MODULES 显式指定）
export const DEFAULT_ENABLED_MODULE_IDS = ['example', 'sms']
```

如果只改 `ENABLED_MODULES` 而不改 catalog，启动会报：

```text
Unknown enabled module: sms
```

### 4. 执行迁移

```bash
# 主库 + 模块迁移（推荐发布/首次运行）
pnpm db:migrate:release

# 或者在开发模式下直接启动，启动插件会自动执行迁移与 seed
```

模块迁移会创建 `sms_*` 表，并把 `module_states` 写成 `migrated`。

### 5. 启动

```bash
pnpm dev
```

如果没有把 `sms` 放进默认列表：

```bash
ENABLED_MODULES=example,sms pnpm dev
```

### 6. 访问

- 学校页面：<http://localhost:3000/sms>
- 模块管理：<http://localhost:3000/dashboard/modules>
- 后台首页：<http://localhost:3000/dashboard>

默认管理员（由主仓库 seed 创建）：`admin@example.com` / `Admin@123`。

---

## 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `Unknown enabled module: sms` | 只设置了 `ENABLED_MODULES`，没改 `modules.catalog.ts` | 按第 3 步登记 `smsModule` |
| `/sms` 404 | layer 未启用或克隆目录名不是 `sms` | 确认 `modules/sms/module.ts` 存在，并检查 `ENABLED_MODULES` |
| 模块 API 403 | 模块状态不是 `active`，或无组织成员关系/权限 | 在 `/dashboard/modules` 查看状态；确认用户有 active membership |
| `sms_*` 表不存在 | 模块迁移未执行 | 运行 `pnpm db:migrate:release` 或重启开发服务器 |
| 修改代码后页面没变 | Nuxt layer 是构建期加载 | 重启 `pnpm dev`；生产需重新 `pnpm build` |

> 运行期在 `/dashboard/modules` 停用/卸载模块只影响模块 API 与状态，**不会**卸载已编译的 Nuxt 页面；要彻底移除页面需从 `ENABLED_MODULES` 移除并重新构建。

---

## 契约与测试

模块只从主仓库的 `server/sdk` 导入平台契约，不得 import `server/core/**` 或 `server/utils/**`。主仓库的 `test/unit/server/core/moduleDecoupling.test.ts` 会检查这个边界。

模块测试位于本仓库 `test/`，克隆到 `modules/sms` 后由主仓库的 Vitest 自动包含：

```bash
# 在 Nuxt-Admin 根目录
pnpm test
```
