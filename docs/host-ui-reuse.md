# SMS 工作台复用底座组件

SMS 保留工作台布局。基础资料维护由 SmsCrudPage 适配底座 DashboardCrudPage，模块只传入注册元数据和教育专用插槽。

依赖配套 Nuxt-Admin 的组件扩展，详见 contribution-validation.md。请先安装底座的配套分支，再使用本模块的复用页面。

- 学生、班级、教师、监护人、监护关系、学年、学期、年级、科目、学籍记录共用底座表格、分页、筛选、列显隐、表单、详情和导出。
- /sms/students 和 /sms/classes 保留原地址；其余资料由 /sms/apps/[table] 在工作台内打开。
- 学生批量导入和学籍异动使用模块原入口；考试成绩、发布审批及其他教育流程仍由模块业务服务处理。
- 聊天 RecordDialog 的详情和字段输入复用 DashboardCrudDetail、DashboardCrudForm，字段遮罩和保存时排除只读字段保持原行为。
- CRUD 按钮使用元数据 permissions，并调用与服务端相同的纯权限判定函数。数据范围继续由后端 resolver 强制执行。
- 通用导出使用底座 /export 接口，包含高级筛选；Excel 使用已安装的 xlsx 包，不再依赖 CDN。

新增基础资料页优先注册字段元数据并使用 SmsCrudPage；个性化显示、筛选和业务入口使用插槽，不再复制基础 CRUD 实现。

## 业务列表（2026-11-23）

财务的账单、收款、对账批次，考试和考场，选课，成绩，学生/成绩导入预览，学籍异动和调代课共 11 处列表复用宿主 DashboardBusinessTable → DashboardCrudTable → BasePaginationBar。业务单元格和操作以插槽传入，不暴露通用编辑、删除和批量删除。搜索、数字排序和分页作用于已加载记录，界面明确显示加载数量；服务端原查询上限和页面条件仍适用。周课表是二维教学网格，保留专用展示。
