---
name: notes
description: 个人笔记管理。当用户需要「记录信息/想法/知识」性质的内容使用。
metadata:
  version: "1.0.0"
  author: https://github.com/zsspub
  license: MIT
  updated_at: "2026-04-03"
---

# 存储规则

- 目录：`<本 SKILL.md 所在目录>/../.data/notes/`
- 每条笔记一个 `.md` 文件，带 YAML frontmatter
- 文件名：`YYYYMMDD-HHmmss-slug.md`（本地时间，slug 由标题生成）

文件格式：

```markdown
---
title: "笔记标题"
description: "正文内容的简短描述"
tags: [标签1, 标签2]
created: "2026-04-03 10:30:00"
updated: "2026-04-03 10:30:00"
---

笔记正文…
```

# 核心要点

- **添加笔记**：从用户话语提取标题和正文，整理成结构化 Markdown，自动推断标签
- **编辑笔记**：修改后更新 `updated` 时间戳
- **标签**：用户未指定时自动推断（技术/学习/工作/想法/生活等），优先复用已有标签保持一致性
