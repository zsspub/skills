---
name: todos
description: "个人待办事项管理。当用户表达以下任意意图时触发此 skill：1) 想记住某件事——如「帮我记一下…」「别忘了…」「提醒我…」「备忘…」「记得…」；2) 想去做某件事——如「我要…」「我想…」「我打算…」「我计划…」「得去…」「回头要…」「改天要…」；3) 查看/管理任务——如「今天有什么要做的」「看一下待办」「列一下任务」「有什么还没做的」；4) 完成/删除/更新任务——如「做完了」「搞定了」「删掉…」「改一下…」。关键判断逻辑：只要用户话语中隐含「未来要处理的事项」或「需要被记录以免遗忘的事情」，即使没有出现「todo」「待办」等关键词，也应触发。"
argument-hint: "add|list|done|delete|update|export|import|config [选项]"
metadata:
  version: "1.2.0"
  data_version: "1.0.0"
  author: https://github.com/zsspub
  license: MIT
  updated_at: "2026-04-03"
---

# 待办事项技能

基于本地 SQLite 数据库管理持久化待办事项列表。数据文件由脚本通过 `import.meta.dirname` 自动定位，存放在与 skill 目录同级的 `.data/zsspub/todos/` 目录下，无需手动配置路径。时间以 UTC 存入数据库，展示时自动按用户配置的时区进行转换。

## 环境要求

- Node.js >= 22.5.0（使用内置 `node:sqlite`）

## 执行方式

所有命令均通过 `node` 直接运行脚本，无需安装任何全局命令：

```bash
node <本 SKILL.md 所在目录>/scripts/todos.mjs <命令> [选项]
```

下文中 `todos` 均代表 `node <skill目录>/scripts/todos.mjs`，请替换为实际路径。

## 首次使用：配置时区

脚本以 UTC 存储时间，展示时按配置的时区转换。**首次使用时**，根据上下文推断用户时区（如语言、提到的城市、系统环境），直接设置即可，无需询问。实在无法判断时简单问一次，用户不答则默认 `UTC`。

```bash
todos config --timezone=Asia/Shanghai
```

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

**日期推断：**
- "今天"→ 当天；"明天"→ 次日；"后天"→ 后天
- "这周"/"本周"→ 本周日；"下周"→ 下周日；"下周X"→ 下周对应星期几
- "月底"→ 当月最后一天；"下月初"→ 下月 1 日
- "X 小时后"/"X 分钟后"→ 当前时刻加对应时间量
- "X 天后"→ 当前日期加 X 天

**时段词推断（确定日期后，用时段词决定具体时间）：**

用户表达中常含时段词（如「今天晚上」「明天上午」），这些词反映了用户心理上期望完成的时段，用它来设置截止时间比统一用 23:59:59 更有意义。

| 时段词 | 映射时间 | 示例 |
|---|---|---|
| 早上 / 一早 / 上午 | 09:00:00 | "明天上午" → 次日 09:00 |
| 中午 / 午饭前 | 12:00:00 | "中午之前" → 当天 12:00 |
| 下午 | 14:00:00 | "下午搞定" → 当天 14:00 |
| 下午X点 / 上午X点 | 具体小时:00:00 | "下午三点前" → 15:00 |
| 傍晚 / 下班前 | 18:00:00 | "下班前" → 当天 18:00 |
| 晚上 / 今晚 / 回去后 | 20:00:00 | "今天晚上" → 当天 20:00 |
| 无时段词 | 23:59:59 | "明天" → 次日 23:59:59 |

当用户说了具体的「X点」「X:XX」，以用户给出的时间为准，时段词仅作上下午判断辅助（如「下午三点」→ 15:00 而非 03:00）。

**优先级推断：**
- 语气急迫（"马上"、"紧急"、"立刻"、"赶紧"、"尽快"）→ `high`
- 语气轻松/不急（"有空的时候"、"回头"、"改天"、"抽空"）→ `low`
- 其他情况 → `medium`

**其他：**
- 若需要 id 但用户没提供，先运行 `list` 展示结果，再请用户确认
- 用户在一句话中提到多个操作（如"XX做完了，再帮我加一个…"），按顺序依次执行

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
