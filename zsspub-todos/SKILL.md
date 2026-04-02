---
name: zsspub-todos
description: "管理存储在本地 SQLite 中的个人待办事项列表，支持添加、查看、完成、删除、更新和搜索任务，以及按优先级、标签、截止日期筛选。每当用户提到要记一件事、提醒自己做某事、查看今天有什么任务、把某件事标记为完成、想整理一下待办清单、搜索待办内容，都应主动使用这个 skill，即使用户没有明确说“todo”或“待办”。英文场景同样适用，如 remind me to、add to my todo list、what do I have today、mark X as done。"
argument-hint: "add|list|done|delete|update|export|import|config [选项]"
metadata:
  version: "1.1.0"
  data_version: "1.0.0"
  author: https://github.com/aximario
  license: MIT
  updated_at: "2026-04-02"
---

# 待办事项技能

基于本地 SQLite 数据库管理持久化待办事项列表。数据文件由脚本通过 `import.meta.dirname` 自动定位，存放在与 skill 目录同级的 `.data/zsspub-todos/` 目录下，无需手动配置路径。时间以 UTC 存入数据库，展示时自动按用户配置的时区进行转换。

## 环境要求

- Node.js >= 22.5.0（使用内置 `node:sqlite`）

## 执行方式

所有命令均通过 `node` 直接运行脚本，无需安装任何全局命令：

```bash
node <本 SKILL.md 所在目录>/scripts/todos.mjs <命令> [选项]
```

下文中 `todos` 均代表 `node <skill目录>/scripts/todos.mjs`，请替换为实际路径。

## 首次使用：配置时区

脚本将时间以 UTC 存入数据库，展示时按用户配置的时区转换。**首次使用时**，请先判断用户的时区并运行 `config --timezone` 命令：

- 若用户提到城市（如“我在上海”、“我在北京”），推断为 `Asia/Shanghai`
- 若用户明确说明时区（如“我用 UTC+8”），推断对应 IANA 标识符
- 若无法判断，询问用户所在城市或时区，然后运行：

```bash
todos config --timezone=Asia/Shanghai
```

常用 IANA 时区标识符：

| 地区 | 标识符 |
|---|---|
| 中国大陆 / 台湾 / 香港 | `Asia/Shanghai` 或 `Asia/Taipei` |
| 日本 | `Asia/Tokyo` |
| 美国东部 | `America/New_York` |
| 美国西部 | `America/Los_Angeles` |
| 英国 / 西欧 | `Europe/London` / `Europe/Paris` |
| UTC | `UTC` |

用户随时可通过 `todos config --timezone=<新时区>` 更新配置。

## 使用流程

### 第一步：理解用户意图，映射到命令

根据用户的自然语言请求判断要执行的命令：

| 用户说的话（示例） | 应执行的命令 |
|---|---|
| "帮我记一下明天要交报告" | `add`，根据语义推断优先级和截止日期 |
| "今天有什么要做的？" / "列一下待办" | `list`（默认只显示 pending） |
| "把#3 标记完成" / "那个报告做完了" | `done <id>` |
| "删掉买菜那条" | 先 `list` 找到对应 id，再 `delete <id>` |
| "把第2条改成明天上午交" | `update <id> --due="..."` |
| "查一下高优先级的任务" | `list --priority=high` |
| "帮我找一下关于报告的任务" / "有没有跟工作相关的待办" | `list --search=关键字` |
| "导出待办" / "备份一下我的任务" / "把待办导出成文件" | `export` |
| "导入待办" / "从文件导入" / "恢复待办数据" | `import --file=<路径>` |

**推断规则：**
- 用户说"今天"→ due 设当天 23:59:59；"明天"→ 次日 23:59:59；"后天"→ 后天 23:59:59
- "这周" / "本周"→ 本周日 23:59:59；"下周"→ 下周日 23:59:59；"下周X（如下周三）"→ 下周对应星期几的 23:59:59
- "月底"→ 当月最后一天 23:59:59；"下月初"→ 下月 1 日 23:59:59
- "X 小时后" / "X 分钟后"→ 当前时刻加对应时间量
- 用户没说优先级时，若语气急迫（"马上"、"紧急"、"立刻"）→ `high`，否则默认 `medium`
- 若需要 id 但用户没提供，先运行 `list` 展示结果，再请用户确认

### 第二步：执行命令并呈现结果

将命令输出直接展示给用户，不要省略或重新排版。若命令失败，把 stderr 内容告知用户并给出建议。

- 若输出中有标注 `⚠️已过期` 的任务，主动提醒用户处理。
- 若 `list` 返回较多条目（10 条以上），在展示列表后给出简短摘要，例如：“共 X 条待办，其中 Y 条已过期，最近截止的是「标题」（截止 日期）。”

## 命令说明

### 添加待办
```
todos add "标题" [--priority=low|medium|high] [--tags=标签1,标签2] [--due="YYYY-MM-DD HH:mm:ss"]
```
- `--priority`：`low`（低）、`medium`（中，默认）或 `high`（高）
- `--tags`：逗号分隔的标签列表，例如 `工作,紧急`
- `--due`：截止时间，格式严格为 `YYYY-MM-DD HH:mm:ss`（用户所在时区的本地时间）

### 列出待办
```
todos list [--status=pending|done|all] [--priority=low|medium|high] [--tag=标签名] [--search=关键字] [--due-before="YYYY-MM-DD HH:mm:ss"] [--due-after="YYYY-MM-DD HH:mm:ss"]
```
- 默认仅列出 `pending`（待完成）的任务
- `--search`：按标题关键字模糊匹配，例如 `--search=报告`
- 排序：优先级（高→低）→ 截止日期（最早优先）→ id

### 标记为完成
```
todos done <id>
```

### 删除待办
```
todos delete <id>
```
别名：`del`、`rm`

### 更新待办
```
todos update <id> [--title="新标题"] [--priority=...] [--tags=...] [--due="YYYY-MM-DD HH:mm:ss"]
```
- 清除截止日期：`--due=null`

别名：`edit`

### 导出待办
```
todos export [--file=<路径>] [--status=pending|done|all]
```
- `--file`：导出文件路径（可选）。不指定时自动生成文件名 `todos-YYYYMMDD-HHmmss.csv`（UTC 时间戳），存放在 `.data/zsspub-todos/` 目录下
- `--status`：导出的任务状态筛选（默认 `all`，即全量导出）
- CSV 中的时间字段（`due_date`、`created_at`）均为 UTC 原始值

### 导入待办
```
todos import --file=<路径>
```
- `--file`：CSV 文件路径（必需）
- CSV 必须包含 `title` 列，否则拒绝导入
- 可选列：`status`（pending/done）、`priority`（low/medium/high）、`tags`、`due_date`（UTC，格式 `YYYY-MM-DD HH:mm:ss`）
- 未提供的可选列取默认值：`status=pending`、`priority=medium`、`tags=空`、`due_date=空`
- CSV 中的 `id` 和 `created_at` 列会被忽略（由数据库自动生成）
- **原子性**：先校验所有行，任一行不合法则整体拒绝导入，不写入任何数据
- 校验失败时输出具体错误行号和原因

### 查看/更新配置
```
todos config [--timezone=<IANA时区>]
```
- 无参数：打印当前配置（时区、数据版本）
- `--timezone`：设置时区（必须为有效的 IANA 标识符，如 `Asia/Shanghai`）

## 示例

```bash
# 添加一个高优先级任务，带标签和截止日期
todos add "提交季度报告" --priority=high --tags=工作 --due="2026-05-01 18:00:00"

# 列出所有待完成任务（默认视图）
todos list

# 列出所有任务（包括已完成）
todos list --status=all

# 仅列出高优先级任务
todos list --priority=high

# 按标签筛选
todos list --tag=工作

# 按截止日期筛选（截止日期在本周内）
todos list --due-before="2026-05-07 23:59:59"

# 将第 3 条待办标记为完成
todos done 3

# 更新第 2 条待办的标题和截止日期
todos update 2 --title="修订后的报告" --due="2026-05-02 09:00:00"

# 删除第 5 条待办
todos delete 5

# 查看当前配置（时区、数据版本）
todos config

# 设置时区为中国标准时间（UTC+8）
todos config --timezone=Asia/Shanghai

# 导出所有待办到自动命名的 CSV 文件（存放在 .data/zsspub-todos/ 下）
todos export

# 导出待完成任务到指定文件
todos export --file=my-todos.csv --status=pending

# 从 CSV 文件导入待办
todos import --file=my-todos.csv
```
