# Nuxt-Extend-SMS — 学校管理系统模块 / School Management System

一个**独立的、解耦的 Nuxt 4 layer**，挂载到主管理项目 `Nuxt-Admin` 上，提供一套**学校信息管理系统**：公开站点（公告 / 文章 / 活动）、多角色门户（管理员 / 教师 / 学生 / 监护人）、课程与成绩册、考勤、行为奖惩、带冲突检测的课表排课、可打印的成绩报告单，以及「教师录入 → 管理员审批」的工作流。

它与 `nav`、`doc`、`library`、`photo`、`music` 是平级的兄弟模块，可以任意组合启用。

> An independent, decoupled Nuxt 4 layer that mounts onto the host `Nuxt-Admin` project: a school information system with a public site (notices / articles / activities), a multi-role portal (admin / teacher / student / guardian), courses & gradebook, attendance, conduct, a clash-checked timetable, printable report cards, and a teacher-submit → admin-approve workflow.

> **关键：本模块不是独立应用，没有自己的 `package.json`，不能单独 `pnpm dev`。它只能作为主项目的 layer，随主项目的 `dev` / `build` 一起运行。**
> **IMPORTANT: This is NOT a standalone app. It has no `package.json` of its own and cannot run on its own — it mounts into the host project and runs together with it.**

---

## 目录 / Contents

- [它做什么](#它做什么)
- [如何运行](#如何运行--running)
- [挂载机制](#挂载机制--how-it-is-mounted)
- [角色与权限](#角色与权限--roles--permissions)
- [数据模型](#数据模型--data-model)
- [接口一览](#接口一览--api)
- [页面一览](#页面一览--pages)
- [配置项](#配置项--configuration)
- [录入 → 审批工作流](#录入--审批工作流--submit--review)
- [目录结构](#目录结构--directory-anatomy)
- [测试](#测试--tests)
- [已知边界](#已知边界--known-boundaries)

---

## 它做什么

| 领域 | 能力 |
| --- | --- |
| 公开站点 | 首页（计数 / 公告板 / 最新文章 / 近期活动，匿名可读）、公告、文章（含 slug 详情页与阅读数）、活动 |
| 门户 Portal | 同一个 URL，按角色渲染不同内容：管理员看全校统计与待审，教师看自己的课程 / 班级 / 今日课表 / 待审，学生看均分 / 出勤 / 近期行为 / 待交作业，监护人看多个子女的概览 |
| 课程与成绩册 | 一门课 = 若干**考核项**（kind + 权重% + 满分），成绩册按学生 × 考核项成网格；加权总分、等级、班级排名、每项统计；权重必须合计 100% |
| 考勤 | 按学生 / 日期（可选按节次）点名；事假与病假不计入出席率分母，迟到算出勤；一键「全部出勤」；整门课的出勤率汇总 |
| 课表 | 节次（铃铛表）+ 排课（课程 × 星期 × 节次 × 教室）；**写入时检测教师 / 教室 / 班级冲突**，冲突列表与红色单元格同源 |
| 行为奖惩 | 类别 → 条款（正分，方向由类别决定）→ 记录；记录**快照**当时的分数与方向，改条款不会改写历史 |
| 成绩报告单 | 单课程加权分、覆盖率、等级、班级排名、奖惩与出勤汇总；**可打印**（浏览器打印成 PDF） |
| 审批工作流 | 教师把「成绩 / 考勤 / 行为」按批次提交 → 管理员审批 / 退回 / 撤回；**已批准的批次会锁定对应数据**，直到撤回 |
| 后台管理 | 所有 `sms_` 表接入宿主后台通用 CRUD（列表 / 表单 / 详情 / 高级筛选 / 导入导出 / 软删除），其中 23 张表进入侧边菜单 |

---

## 如何运行 / Running

> 前置：先按主项目 README 把 **`Nuxt-Admin`** 跑起来（`pnpm install` → `cp .env.example .env`（至少 `DATABASE_URL`、`SESSION_SECRET`）→ `pnpm db:migrate`）。

1. **把本模块放进主项目的 `modules/`（一次性）：**

   ```bash
   git clone git@github.com:FrankOldmoon/Nuxt-Extend-SMS.git <host>/modules/sms
   ```

2. **在主项目 `.env` 打开开关**（主项目 `nuxt.config.ts` 会自动扫描 `modules/`，挂载任何设置了 `SMS_ENABLED=true` 的目录）：

   ```bash
   SMS_ENABLED=true
   ```

   可选：默认启用后本模块会**接管站点根路径 `/`**（`/` 即学校首页）。若要与其它模块共存或保留原首页：

   ```bash
   SMS_TAKE_SITE_ROOT=false
   ```

3. **用主项目启动：**

   ```bash
   pnpm dev            # 然后访问 http://localhost:3000/
   ```

启动时模块会自动：登记配置项 → 注册 Drizzle schema（26 张表可被通用 CRUD 发现）→ 幂等迁移建表（`sms_` 前缀）→ 把 23 张表注册进后台侧边菜单 → 空表时灌入一份可用的学校种子（当前学期、8 节铃铛表、5 个科目、奖惩类别与条款）→ 把 8 个导航节写入宿主 `site.navigation`。

---

## 挂载机制 / How it is mounted

- **Layer（页面 / i18n）**：主项目 `nuxt.config.ts` 扫描 `modules/` 后把本目录作为 layer `extends`。本模块 `nuxt.config.ts` 声明自己的 `i18n` locale 文件（`en` / `zh` / `zh-TW`）。
- **模块入口（`index.ts`）**：`defineNuxtModule`，读 `SMS_ENABLED`；在构建期从本模块 locale 文件读出导航标签，经 `runtimeConfig.public` 交给主项目（宿主 header 渲染的是纯文本，没有按语言查表）。接管首页用 **`pages:resolved`**（在所有 `pages:extend` 之后运行），移除当前 `/` 并注入 `app/pages/sms/index.vue` + `meta: { layout: 'school' }`——这样「SMS 启用 ⇒ `/` 是学校首页」是确定的，而不是取决于目录挂载顺序。
- **Nitro 插件（`server/plugins/sms.ts`）**：启动时登记配置、`registerDrizzleSchema`、迁移、注册后台菜单、种子、发布导航。字段元数据不手写——由 `autoDiscoverTable` 从 Drizzle 表定义推断（类型 / 可空 / 外键 / 多对多虚拟字段），模块只额外提供图标与顺序。

---

## 角色与权限 / Roles & permissions

单一处策略在 `server/utils/access.ts`，路由不再各自发明规则。读范围用 `readableStudentIds`：`null` = 全部，数组 = 指定集合，`[]` = 不可见（匿名访客天然看到空）。

| 角色 | 可读 | 可写 |
| --- | --- | --- |
| `admin` | 全部 | 全部（含审批） |
| `teacher` | 校目录与任意学生 | **仅自己任教的课程**（成绩 / 考勤）；行为记录是「教职工级」 |
| `student` | 自己的记录、本班课表 | 自己的反馈 |
| `guardian` | 子女的记录、子女所在班课表 | 自己的反馈 |
| `anonymous` | 公开首页与已发布内容 | 无 |

两条判断值得点明：教师**可读**任意学生（要教这个孩子前查一下，目录是内部工具）；但**只能写**自己任教的课程（`mayWriteCourse` 按课程判定，而不是按角色一刀切）。对学生不可见的记录一律返回 **404 而不是 403**（403 等于确认该 id 存在）。

---

## 数据模型 / Data model

所有表 `sms_` 前缀，仅属于本模块；与宿主 `users` 的关联**故意不加数据库外键**（模块不依赖宿主迁移，且学校可能先于账号存在），但关系仍声明给后台元数据解析姓名。

**组织 / 人员 / 课程**

| 表 | 作用 |
| --- | --- |
| `sms_departments`、`sms_grades`、`sms_classes`、`sms_subjects`、`sms_semesters`、`sms_classrooms` | 学部 / 年级 / 班级 / 科目 / 学期（含「当前学期」标记）/ 教室 |
| `sms_teachers`、`sms_students`、`sms_guardians` | 教师 / 学生 / 监护人（都是宿主用户的一种角色，非第二套账号；监护人可无账号） |
| `sms_student_guardians` | 学生 ↔ 监护人（`is_primary` 标记第一联系人） |
| `sms_courses`、`sms_course_teachers`、`sms_course_students` | 开课 / 任课教师（`lead` / `assistant`）/ 名单（选课，成绩册与考勤都读它） |

**课表 / 考勤 / 考核**

| 表 | 作用 |
| --- | --- |
| `sms_periods` | 节次（铃铛表：名称、序号、起止、`class` / `break`） |
| `sms_timetable_entries` | 排课：课程 × 星期 × 节次 × 可选教室（一行 = 每周一节课，学期课表是可重复的模式） |
| `sms_attendance_records` | 考勤：一学生 × 一日期（可选一节次），唯一索引用 `coalesce(period_id, 0)` |
| `sms_assessments` | 考核项：`kind`（usual / homework / quiz / midterm / final / project / other）+ `weight`% + `max_score` |
| `sms_scores` | 成绩：一学生 × 一考核项；`score` 可空 = **未评**（不等于 0） |
| `sms_submissions` | 提交审批：一批记录一个状态（pending / approved / rejected / withdrawn） |

**行为 / 内容**

| 表 | 作用 |
| --- | --- |
| `sms_conduct_categories`、`sms_conduct_rules`、`sms_conduct_records` | 奖惩类别（merit / demerit）→ 条款（正分）→ 记录（快照当时的 points 与 kind） |
| `sms_notices`、`sms_articles`、`sms_activities` | 公告（受众 + 置顶 + 过期）、文章（slug + 阅读数）、活动（时间 + 地点） |
| `sms_feedback` | 反馈 / 建议：`kind` + `status`（open / in_progress / closed）+ 回复 |

**五条设计决定**（详见 `server/database/schema.ts` 头注释）：① 一套考核模型（不是 exams/quizzes/homeworks 四套）；② 课表 = 节次 + 排课（`courses.weekday` 表达不了「周二第 3 节在 Lab 2」也无法查冲突）；③ 考勤按学生 / 日期 / 可选节次；④ 教师工作先提交再审批（状态在批次上，记录不会与批次不一致）；⑤ 奖惩对称（`kind` 决定方向，分数永远为正，记录快照历史）。

---

## 接口一览 / API

全部挂在 `/api/sms/` 下（共 45 个端点）。除公开内容与设置外，多数需要登录 / 教职工 / 管理员。

**公共与门户**

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/home` | 公开首页聚合（计数 / 公告 / 文章 / 活动 / 当前学期 / 访客） |
| GET | `/config` | 学校名、及格线、当前学期（公开，首页在访客未知前就要用） |
| GET | `/me` | 当前访客（未登录返回 `anonymous`，不 401） |
| GET | `/portal` | 按角色拼装的门户数据（teacher / student / guardian / admin 各一块） |

**内容**

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET / POST | `/notices` | 公告列表（分页、搜索、受众） / 发布（教职工） |
| GET | `/notices/:id` | 单条公告（草稿仅教职工可见） |
| GET / POST | `/articles` | 文章列表 / 新建或编辑（`id` 决定，slug 由标题派生，教职工） |
| GET | `/articles/:slug` | 按 slug 读文章并 +1 阅读数 |
| GET / POST | `/activities` | 活动列表（`?upcoming=1` 只看未来） / 新建或编辑（教职工） |
| GET / POST | `/feedback` | 反馈列表（非教职工只见自己的） / 提交反馈（需登录） |
| POST | `/feedback/:id` | 处理一条反馈（教职工改状态 / 回复；属主只读） |

**目录与参考数据**

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/students`、`/students/:id` | 学生目录（按读范围过滤）/ 学生档案（档案外 404） |
| GET | `/students/:id/report-card` | 成绩报告单（`?semesterId=` 可选，默认当前学期） |
| GET | `/classes`、`/classes/:id` | 班级列表 / 班级详情（名单按读范围过滤 + 课程） |
| GET | `/teachers`、`/guardians` | 教师目录 / 监护人目录（含子女） |
| GET | `/reference` | 学部 / 年级 / 科目 / 学期 / 教室 / 节次，供所有筛选器与选择器 |
| GET | `/attendance/summary` | 出勤报表（按课程 / 班级 / 学生 + 时间窗） |

**课程**

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/courses`、`/courses/:id` | 课程列表（`?mine=1`）/ 课程总览（课程 + 考核项 + 名单 + 每周课 + 权重校验） |
| POST | `/courses/:id/roster` | 加 / 退学生（`{ add:[], remove:[] }`，退课是停用而非删除） |
| POST | `/courses/:id/assessments`、DELETE `.../assessments/:assessmentId` | 新建 / 编辑考核项、软删除 |
| GET / POST | `/courses/:id/gradebook` | 成绩册网格 / 保存某考核项的分数（已批准则 409） |
| GET / POST | `/courses/:id/attendance` | 某日（可选节次）点名表 / 保存点名（已批准日期锁定） |
| POST | `/courses/:id/lessons`、DELETE `.../lessons/:lessonId` | 加一节课（写入前查冲突，冲突则 409 并回传冲突清单）/ 删一节课 |

**课表 / 行为 / 审批**

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/timetable` | 周课表（班级 / 教师 / 教室 / 全校 四选一作用域）+ 冲突 + 已排好的网格 |
| GET | `/timetable/conflicts` | 全校冲突报告（教职工） |
| GET | `/conduct/categories`、`/conduct/rules` | 奖惩条例（公开可读，规则按类别方向） |
| GET / POST | `/conduct/records` | 奖惩台账（按读范围过滤）/ 记一条（教职工） |
| DELETE | `/conduct/records/:id` | 撤回一条（软删除，教职工） |
| GET / POST | `/submissions` | 提交队列（教职工）/ 开一批提交 |
| POST | `/submissions/:id` | 审批：`approve` / `reject`（管理员，仅 pending）/ `withdraw`（提交者或管理员） |

---

## 页面一览 / Pages

模块自带页面在 `/sms/**`，`/`（首页）由入口注入。

| 路径 | 页面 |
| --- | --- |
| `/`（= `/sms`） | 学校公开首页：计数、公告板、最新文章、近期活动、角色入口 |
| `/sms/notices` | 公告板（搜索 + 受众筛选 + 分页） |
| `/sms/articles`、`/sms/articles/:slug` | 文章档案 / 文章详情 |
| `/sms/activities` | 活动（未来 / 历史切换） |
| `/sms/dashboard` | 门户：按角色渲染 |
| `/sms/timetable` | 周课表（教职工可切换全校 / 班级 / 教师 / 教室；学生锁本班；监护人选择子女）+ 冲突列表 |
| `/sms/courses`、`/sms/courses/:id` | 课程目录 / 课程详情（概览 · 名单 · 考核项 · 成绩册 · 考勤 五个视图） |
| `/sms/classes`、`/sms/classes/:id` | 班级目录 / 班级详情（学生 · 课程 · 课表） |
| `/sms/students`、`/sms/students/:id` | 学生目录 / 学生档案（出勤 · 监护人 · 行为） |
| `/sms/students/:id/report-card` | 成绩报告单（可打印） |
| `/sms/teachers`、`/sms/guardians` | 教师目录 / 监护人目录 |
| `/sms/conduct` | 行为台账 + 奖惩条例 + 记录（教职工） |
| `/sms/review` | 提交审批队列（教职工，管理员可批） |
| `/sms/feedback` | 反馈：提交 + 我的记录；教职工看队列并回复 |
| `/sms/account` | 我的账号（门户角色与关联记录） |
| `/sms/organization` | 组织架构总览（学部 / 年级 / 科目 / 学期 / 教室 / 节次，仅教职工，只读） |

---

## 配置项 / Configuration

写在共享 `configs` 表里，可在宿主后台「系统配置」修改，重启不丢：

| key | 默认 | 说明 |
| --- | --- | --- |
| `sms.enabled` | `true` | 模块总开关 |
| `sms.schoolName` | `Springfield School` | 公开首页与报告单上的学校名 |
| `sms.passMark` | `60` | 及格百分比（决定等级 D 的下界与红色标记） |
| `sms.siteNavigation` | `true` | 是否把 8 个导航节写入宿主 header |
| `sms.currentSemesterId` | （种子写入） | 新建课程 / 记录默认归属的学期 |

运行时公开配置（`nuxt.config.ts` → `runtimeConfig.public`）：`smsMaxPageSize`、`smsNavLocale`、`smsNavLabels`（后两者由 `index.ts` 在构建期从 locale 文件读入）。

环境变量（宿主 `.env`）：`SMS_ENABLED`、`SMS_TAKE_SITE_ROOT`。

---

## 录入 → 审批工作流 / Submit → review

1. 教师在课程页录入成绩 / 考勤（或记行为），点「提交审批」——记录挂到一条 `sms_submissions`（同类型同课程的 pending 批次会被复用，避免重复开批）。
2. 管理员在 `/sms/review` 审批：**通过**则记录成为正式数据、对应数据被**锁定**（成绩册 409、考勤按日期锁定）；**退回**可附说明，教师改完再提交；**撤回**（提交者或管理员）解除锁定。
3. 状态在批次上，而不是每条记录上——「批准这一班的中考成绩」是一个动作，且记录不会与批次对状态不一致。

---

## 目录结构 / Directory anatomy

```
modules/sms/
├── index.ts                         # 模块入口：SMS_ENABLED 开关 + pages:resolved 接管首页 + 导航标签
├── nuxt.config.ts                   # layer 的 i18n locale 文件 + runtimeConfig.public
├── README.md
├── i18n/locales/{en,zh,zh-TW}.json  # 模块 i18n（nav / common / 各页面文案）
├── app/
│   ├── pages/sms/                   # 首页、公告、文章、活动、门户、课表、课程、班级、学生、报告单、教师、监护人、行为、审批、反馈、账号、组织
│   ├── layouts/school.vue           # 学校外壳（宿主 header + 角色徽标 + 页脚，打印时隐藏）
│   ├── components/sms/              # RoleBadge / PageHeader / EmptyState / StatCard / 徽标 / 课表网格 / 内容卡片
│   │   └── course/                  # Gradebook 与 AttendanceSheet 两个重编辑器
│   └── composables/
│       ├── useSms.ts                # 客户端类型 + 格式化助手 + 全部 fetcher（与后端 DTO 对齐）
│       ├── useSmsViewer.ts          # 共享当前访客（复用布局的 sms:viewer）
│       ├── useSmsSettings.ts        # 共享学校设置（sms:school）
│       └── useSmsReference.ts       # 共享参考数据（sms:reference）
├── server/
│   ├── database/
│   │   ├── schema.ts                # 26 张表的 Drizzle 定义 + 设计说明
│   │   └── migrate.ts               # 幂等 DDL（sms_ 前缀）
│   ├── api/sms/                     # 45 个端点（见「接口一览」）
│   ├── utils/
│   │   ├── access.ts                # 角色 / 读范围 / 写权限 / 当前学期 / 学校设置
│   │   ├── dto.ts                   # 各实体的统一投影（计数用相关子查询，避免 N+1）
│   │   ├── grading.ts               # 纯函数：加权总分、覆盖率、等级、排名、报告单汇总
│   │   ├── attendance.ts            # 纯函数：出席率（事假病假不计分母、迟到算出席）
│   │   ├── timetable.ts             # 纯函数：网格构建、冲突检测、利用率
│   │   └── http.ts                  # 请求参数解析（分页 / 数字 / 布尔 / 日期回环校验 / LIKE 转义）
│   └── plugins/sms.ts               # 启动：配置 / schema / 迁移 / 菜单 / 种子 / 导航
├── test/                            # 单测（server 纯函数 + 客户端格式化）
└── vitest.config.ts
```

---

## 测试 / Tests

```bash
# 模块单测（5 个文件 / 69 个用例）
pnpm exec vitest run --config modules/sms/vitest.config.ts

# 静态检查（modules/ 被主项目 gitignore，需 --no-ignore 才会被 lint 到）
pnpm exec eslint --no-ignore modules/sms
SMS_ENABLED=true pnpm typecheck
```

单测覆盖（均为无 DB 依赖的纯函数）：`grading`（百分比归一与钳制、权重校验、加权总分把「未评」排除在分母外、等级 / 绩点、并列排名、学分加权均分、报告单汇总）、`attendance`（事假病假不计分母、迟到算出勤、出勤率、按学生汇总、默认全勤）、`timetable`（网格构建跳过课间、教师 / 教室 / 班级冲突、三方冲突、稳定排序、利用率）、`http`（分页钳制、参数解析、日期回环校验、LIKE 转义）、以及客户端格式化（日期按 UTC 无时区漂移、百分比 / 分数格式化、`ageFrom`、`passesMark`、`relationKey`）。主项目的 `pnpm test` 也会通过 `modules/*/test/**` 一并收集这些用例。

---

## 已知边界 / Known boundaries

- **`zh.json` / `zh-TW.json` 目前是英文占位**：只有 `en` 是权威文案，另外两个 locale 文件尚未翻译（结构与 `en` 一致，替换值即可）。
- **三张 pivot 表无模块内编辑 UI**：`sms_course_teachers`（任课教师）与 `sms_student_guardians`（学生监护人关联）通过宿主后台通用 CRUD 维护；学生名单（`sms_course_students`）则在课程详情「名单」视图里增删。
- **数据录入靠后台**：学生 / 教师 / 班级 / 科目 / 学期 / 教室的新建与编辑走宿主后台通用 CRUD（模块已把 23 张表接入侧边菜单）；门户页面侧重「读 + 角色动作」。
- **审批会锁数据**：成绩批次一旦 `approved`，该课程成绩册拒绝写入（409）；考勤按日期锁定——直到批次撤回。
- **日期 vs 时刻**：`date` 列（生日、点名日、奖惩日）是**日历日期**，以 `YYYY-MM-DD` 传输、按 UTC 展示，不随时区漂移；时间戳（发布时间、截止时间、提交时间）是真实时刻，按访客时区展示。
- **「未评」不是 0**：某考核项没分数时不计入加权分母，报告单同时给出 `coverage`（「基于该科 60% 的权重」）。
- **权重必须合计 100%**：课程页与成绩册会提示 `weightsValid` / `weightSum`，但不会替使用者猜。
