---
name: habits
description: "管理每日打卡记录。"
metadata:
  version: "1.0.0"
  author: https://github.com/zsspub
  license: MIT
  updated_at: "2026-04-04"
---

# 每日打卡技能

通过 curl 调用 `https://zss.pub` API 管理每日打卡数据。

## 配置

配置文件：`<本 SKILL.md 所在目录>/../.data/zsspub/habits/config.json`

```json
{ "accessKey": "<用户提供>" }
```

首次使用前需确认配置文件存在且 accessKey 有效，若不存在则创建目录和文件。若用户未提供 access-key，提示用户先配置。

读取：`ACCESS_KEY=$(jq -r '.accessKey' <config.json路径>)`

## API

公共头：`-H "x-access-key: $ACCESS_KEY" -H "Content-Type: application/json"`

### POST /api/habits — 创建打卡
```bash
curl -s -X POST https://zss.pub/api/habits -H "x-access-key: $ACCESS_KEY" -H "Content-Type: application/json" \
  -d '{"topic":"骑行","tags":"运动","duration":30,"note":"5公里","raw":"打卡骑行30分钟","checkedAt":"2026-04-04T11:30:00.000Z"}'
```
字段：
- `topic`（必需）：主题，字符串
- `tags`（可选）：逗号分隔的标签字符串
- `duration`（可选）：时长（分钟），正整数
- `note`（可选）：备注文本
- `raw`（可选）：用户原话，原封不动存储
- `checkedAt`（可选）：打卡时间，ISO8601 UTC 时间，默认当前时间

### GET /api/habits — 列出打卡记录
```bash
curl -s "https://zss.pub/api/habits?topic=骑行&tag=运动&period=week&search=关键字&limit=10" -H "x-access-key: $ACCESS_KEY"
```
参数：
- `topic`（可选）：按主题精确筛选
- `tag`（可选）：按标签筛选
- `date`（可选）：按特定日期筛选（YYYY-MM-DD）
- `period`（可选）：`today` | `week` | `month` | `year`
- `from`（可选）：日期范围开始（ISO8601 UTC）
- `to`（可选）：日期范围结束（ISO8601 UTC）
- `search`（可选）：在主题和备注中模糊搜索
- `limit`（可选）：返回结果数量限制

### GET /api/habits/stats — 统计分析
```bash
curl -s "https://zss.pub/api/habits/stats?period=week&tag=运动" -H "x-access-key: $ACCESS_KEY"
```
参数：
- `topic`（可选）：按主题筛选
- `tag`（可选）：按标签筛选
- `period`（可选）：`today` | `week` | `month` | `year`
- `from`（可选）：日期范围开始
- `to`（可选）：日期范围结束

返回：`{ totalCount, totalDuration, byTopic: { "骑行": { count, duration } }, byTag: { "运动": { count, duration } } }`

### GET /api/habits/streak — 连续打卡
```bash
curl -s "https://zss.pub/api/habits/streak?topic=骑行" -H "x-access-key: $ACCESS_KEY"
```
参数：
- `topic`（可选）：按主题筛选
- `tag`（可选）：按标签筛选

返回：`{ currentStreak, longestStreak, totalDays }`

### GET /api/habits/:id — 获取单条记录
```bash
curl -s https://zss.pub/api/habits/3 -H "x-access-key: $ACCESS_KEY"
```

### PATCH /api/habits/:id — 更新打卡
```bash
curl -s -X PATCH https://zss.pub/api/habits/2 -H "x-access-key: $ACCESS_KEY" -H "Content-Type: application/json" \
  -d '{"duration":45,"note":"新备注"}'
```
可更新字段：`topic`、`tags`、`duration`（设为 `null` 可清除）、`note`、`checkedAt`

### DELETE /api/habits/:id — 删除打卡
```bash
curl -s -X DELETE https://zss.pub/api/habits/5 -H "x-access-key: $ACCESS_KEY"
```
响应：204 No Content
