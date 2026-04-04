---
name: funds
description: "个人基金持仓管理。当用户需要管理自己持有的基金（添加持仓、查看持仓、查看实时净值/估值、修改份额/成本、删除持仓）时使用。注意：本 skill 用于管理「我的基金持仓」，而非查询任意基金行情（后者请用 stock-fund skill）。"
metadata:
  version: "1.0.0"
  author: https://github.com/zsspub
  license: MIT
  updated_at: "2026-04-04"
---

# 基金持仓技能

通过 curl 调用 `https://zss.pub` API 管理个人基金持仓。

## 配置

配置文件：`<本 SKILL.md 所在目录>/../.data/zsspub/funds/config.json`

```json
{ "accessKey": "<用户提供>" }
```

首次使用前需确认配置文件存在且 accessKey 有效，若不存在则创建目录和文件。若用户未提供 access-key，提示用户先配置。

读取：`ACCESS_KEY=$(jq -r '.accessKey' <config.json路径>)`

## API

公共头：`-H "x-access-key: $ACCESS_KEY" -H "Content-Type: application/json"`

### POST /api/funds — 添加持仓
```bash
curl -s -X POST https://zss.pub/api/funds -H "x-access-key: $ACCESS_KEY" -H "Content-Type: application/json" \
  -d '{"fundCode":"110011","fundName":"易方达中小盘混合","shares":1000,"cost":3.25,"channel":"支付宝","remark":"定投"}'
```
字段：
- `fundCode`（必需）：基金代码，字符串（如 `110011`）
- `fundName`（可选）：基金名称
- `shares`（可选）：持有份额，数字，≥0
- `cost`（可选）：买入成本单价，数字，≥0
- `channel`（可选）：购买渠道（如 支付宝、天天基金、银行等）
- `remark`（可选）：备注

### GET /api/funds — 列出所有持仓
```bash
curl -s https://zss.pub/api/funds -H "x-access-key: $ACCESS_KEY"
```
返回用户所有基金持仓，按创建时间倒序排列。

### GET /api/funds/realtime — 实时净值/估值
```bash
curl -s https://zss.pub/api/funds/realtime -H "x-access-key: $ACCESS_KEY"
```
返回用户所有持仓基金的实时数据，每条包含：
- `fundCode`：基金代码
- `name`：基金名称
- `netValue`：上一日确认净值
- `currentValue`：实时净值或盘中估算净值
- `changePercent`：涨跌幅（百分比）
- `valueDate`：净值/估值日期
- `updateTime`：更新时间
- `isEstimate`：是否为估算值（`true`=盘中估值，`false`=已确认净值）

### GET /api/funds/lookup/:code — 按代码查询基金信息
```bash
curl -s https://zss.pub/api/funds/lookup/110011 -H "x-access-key: $ACCESS_KEY"
```
查询单只基金的实时信息，可用于添加持仓前确认基金名称。

### GET /api/funds/:id — 获取单条持仓
```bash
curl -s https://zss.pub/api/funds/3 -H "x-access-key: $ACCESS_KEY"
```

### PATCH /api/funds/:id — 更新持仓
```bash
curl -s -X PATCH https://zss.pub/api/funds/2 -H "x-access-key: $ACCESS_KEY" -H "Content-Type: application/json" \
  -d '{"shares":2000,"cost":3.10}'
```
可更新字段：`fundCode`、`fundName`、`shares`、`cost`、`channel`、`remark`

### DELETE /api/funds/:id — 删除持仓
```bash
curl -s -X DELETE https://zss.pub/api/funds/5 -H "x-access-key: $ACCESS_KEY"
```
响应：204 No Content

## 展示建议

- **实时数据**展示时，结合持仓份额计算持仓市值和盈亏：
  - 持仓市值 = shares × currentValue
  - 持仓成本 = shares × cost
  - 浮动盈亏 = 持仓市值 - 持仓成本
  - 收益率 = (currentValue - cost) / cost × 100%
- 估算值用 `~` 标注，区分已确认净值
- A 股惯例：🔴 红色表示上涨，🟢 绿色表示下跌
