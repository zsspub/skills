---
name: stock-fund
description: >
  查询 A 股实时行情和公募基金估值。当用户提到股票、基金、行情、净值、估值、涨跌时使用。
---

# 用法

```bash
DIR="<本 SKILL.md 所在目录>/scripts"

# 股票/指数行情
node $DIR/query.mjs stock <sh/sz代码> [...]       # 如 sh600519 sz002460
node $DIR/query.mjs stock search <关键词>          # 按名称搜索股票代码

# 基金估值
node $DIR/query.mjs fund <基金代码> [...]          # 如 110022 005827
node $DIR/query.mjs fund search <关键词>           # 按名称搜索基金代码
```

## 流程

1. 用户提供代码 → 直接查询
2. 用户提供名称 → 先 `search` 搜索代码，结果唯一则直接查询，多个则列出候选让用户选择
3. 股票代码格式：`sh`=上证，`sz`=深证（如 sh600519, sz002460, sh000001）

## 注意事项

- 估算净值为盘中估算，官方净值于收盘后公布
- 非交易时间查询显示的是上一交易日的数据
- A 股惯例：🔴 红色表示上涨，🟢 绿色表示下跌
