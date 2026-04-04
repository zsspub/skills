---
name: todos
description: "个人待办事项管理。"
metadata:
  version: "1.0.0"
  author: https://github.com/zsspub
  license: MIT
  updated_at: "2026-04-04"
---

# 待办事项技能

通过 curl 调用 `https://zss.pub` API 管理待办事项。

## 配置

配置文件：`<本 SKILL.md 所在目录>/../.data/zsspub/todos/config.json`

```json
{ "accessKey": "<用户提供>" }
```

首次使用前需确认配置文件存在且 accessKey 有效，若不存在则创建目录和文件。若用户未提供 access-key，提示用户先配置。

读取：`ACCESS_KEY=$(jq -r '.accessKey' <config.json路径>)`

## API

公共头：`-H "x-access-key: $ACCESS_KEY" -H "Content-Type: application/json"`

### POST /api/todos — 创建
```bash
curl -s -X POST https://zss.pub/api/todos -H "x-access-key: $ACCESS_KEY" -H "Content-Type: application/json" \
  -d '{"title":"标题","priority":"medium","tags":"t1,t2","dueDate":"2026-05-01T10:00:00.000Z"}'
```
字段：
- `title`（必需）：字符串
- `priority`（可选）：`low` | `medium`（默认） | `high`
- `tags`（可选）：逗号分隔字符串
- `dueDate`（可选）：ISO8601 UTC 时间

### GET /api/todos — 列出
```bash
curl -s "https://zss.pub/api/todos?status=pending&priority=high&tag=工作&search=关键字" -H "x-access-key: $ACCESS_KEY"
```
参数：
- `status`（可选）：`pending`（默认） | `done` | `all`
- `priority`（可选）：`low` | `medium` | `high`
- `tag`（可选）：按标签筛选
- `search`（可选）：按标题关键字模糊匹配
- `dueBefore`（可选）：截止日期早于此时间（ISO8601 UTC）
- `dueAfter`（可选）：截止日期晚于此时间（ISO8601 UTC）

### PATCH /api/todos/:id/done — 标记完成
```bash
curl -s -X PATCH https://zss.pub/api/todos/3/done -H "x-access-key: $ACCESS_KEY"
```

### PATCH /api/todos/:id — 更新
```bash
curl -s -X PATCH https://zss.pub/api/todos/2 -H "x-access-key: $ACCESS_KEY" -H "Content-Type: application/json" \
  -d '{"title":"新标题","priority":"high","dueDate":null}'
```

### DELETE /api/todos/:id — 删除
```bash
curl -s -X DELETE https://zss.pub/api/todos/5 -H "x-access-key: $ACCESS_KEY"
```
响应：204 No Content
