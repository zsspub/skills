#!/usr/bin/env node
// @version 1.0.1
// @author  https://github.com/aximario

// 需要 Node.js >= 22.5.0（node:sqlite 作为实验性功能可用）
// 自 Node.js 23.4.0 起已稳定（无需额外标志）
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error('错误：node:sqlite 支持需要 Node.js >= 22.5.0。');
  process.exit(1);
}

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ── 数据路径：{skill_install_dir}/../.data/zsspub-todos/data.sqlite ──
// 即与 skill 目录（zsspub-todos/）同级的 .data/zsspub-todos/ 目录下
// 可通过环境变量 TODO_DB_PATH 覆盖（主要用于测试隔离）
const SKILL_DIR = resolve(import.meta.dirname, '..');
const DATA_DIR = join(SKILL_DIR, '..', '.data', 'zsspub-todos');
const DB_PATH = process.env.TODO_DB_PATH ?? join(DATA_DIR, 'data.sqlite');

// ── 数据版本（与 SKILL.md metadata.data_version 保持同步）──────────────────
// data_version 与 skill 代码版本（version）独立，仅代表数据库结构/配置版本
const DATA_VERSION = '1.0.0';
const CONFIG_PATH = process.env.TODO_CONFIG_PATH ?? join(DATA_DIR, 'config.json');

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

// ── 配置加载 ──────────────────────────────────────────────────────────────────
const config = loadConfig();

const db = new DatabaseSync(DB_PATH);

// ── 数据库结构 ────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS todos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT    NOT NULL,
    status     TEXT    NOT NULL DEFAULT 'pending',
    priority   TEXT    NOT NULL DEFAULT 'medium',
    tags       TEXT    NOT NULL DEFAULT '',
    due_date   TEXT,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now'))
  )
`);

// ── 数据迁移 ──────────────────────────────────────────────────────────────────
runMigrations(config, db);

// ── 参数解析器 ───────────────────────────────────────────────────────────────
/** 解析命令行参数，返回 { positional: string[], flags: Record<string, string|boolean> } */
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        flags[key] = arg.slice(eqIdx + 1);
      } else {
        flags[arg.slice(2)] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

// ── 输出辅助函数 ──────────────────────────────────────────────────────────────
const PRIORITY_EMOJI = { high: '🔴', medium: '🟡', low: '🟢' };
const STATUS_LABEL = { pending: '[ ]', done: '[x]' };

/** 加载 config.json；不存在时创建默认配置（UTC 时区、当前数据版本）并写入磁盘 */
function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    const defaults = { data_version: DATA_VERSION, timezone: 'UTC' };
    writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2), 'utf8');
    return defaults;
  }
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    console.error('错误：config.json 解析失败，请检查文件格式。');
    process.exit(1);
  }
}

/** 将配置对象序列化并写回 config.json */
function saveConfig(cfg) {
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

// ── 数据迁移策略（key 格式："{from_version}->{to_version}"）──────────────────
// 当 config.data_version 落后于 DATA_VERSION 时，按 key 匹配对应迁移函数执行
const MIGRATIONS = {
  // 未来在此添加迁移函数，例如：
  // '1.0.0->1.1.0': (db) => { db.exec('ALTER TABLE todos ADD COLUMN note TEXT'); },
};

/** 检测并执行数据迁移；成功后自动更新 config.data_version 并写回磁盘 */
function runMigrations(cfg, db) {
  if (cfg.data_version === DATA_VERSION) return;
  const key = `${cfg.data_version}->${DATA_VERSION}`;
  if (!MIGRATIONS[key]) {
    console.error(`[迁移] 未找到从 ${cfg.data_version} 到 ${DATA_VERSION} 的迁移策略，请更新 skill。`);
    process.exit(1);
  }
  console.log(`[迁移] 数据版本 ${cfg.data_version} → ${DATA_VERSION}，开始迁移…`);
  try {
    MIGRATIONS[key](db);
    cfg.data_version = DATA_VERSION;
    saveConfig(cfg);
    console.log('[迁移] 完成。');
  } catch (err) {
    console.error(`[迁移] 失败：${err.message}`);
    process.exit(1);
  }
}

/** 将 UTC 时间字符串 "YYYY-MM-DD HH:mm:ss" 转换为指定 IANA 时区的本地时间字符串 */
function utcToTZ(utcStr, tz) {
  const [dp, tp] = utcStr.split(' ');
  const [y, mo, d] = dp.split('-').map(Number);
  const [h, mi, s] = tp.split(':').map(Number);
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  return fmt.format(new Date(Date.UTC(y, mo - 1, d, h, mi, s))).replace('T', ' ');
}

/** 将指定 IANA 时区的本地时间字符串 "YYYY-MM-DD HH:mm:ss" 转换为 UTC 时间字符串 */
function tzToUTC(localStr, tz) {
  const [dp, tp] = localStr.split(' ');
  const [y, mo, d] = dp.split('-').map(Number);
  const [h, mi, s] = tp.split(':').map(Number);
  // 将 localStr 视为 UTC 求出 naiveMs，再用目标时区格式化得到该时刻在 tz 中的表示，
  // 二者差值即为偏移量，据此还原真实 UTC
  const naiveMs = Date.UTC(y, mo - 1, d, h, mi, s);
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const tzStr = fmt.format(new Date(naiveMs)).replace('T', ' ');
  const [dp2, tp2] = tzStr.split(' ');
  const [y2, mo2, d2] = dp2.split('-').map(Number);
  const [h2, mi2, s2] = tp2.split(':').map(Number);
  const tzMs = Date.UTC(y2, mo2 - 1, d2, h2, mi2, s2);
  const r = new Date(2 * naiveMs - tzMs);
  const p = v => String(v).padStart(2, '0');
  return `${r.getUTCFullYear()}-${p(r.getUTCMonth()+1)}-${p(r.getUTCDate())} ${p(r.getUTCHours())}:${p(r.getUTCMinutes())}:${p(r.getUTCSeconds())}`;
}

/** 返回当前 UTC 时间字符串 "YYYY-MM-DD HH:mm:ss" */
function getNowUTCStr() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/** 将一条待办记录格式化为单行显示字符串，包含序号、状态、优先级、标题、标签、截止时间和创建时间 */
function formatRow(t) {
  const pri = PRIORITY_EMOJI[t.priority] ?? t.priority;
  const now = getNowUTCStr();
  const overdue = t.due_date && t.status === 'pending' && t.due_date < now ? ' ⚠️已过期' : '';
  const due = t.due_date ? ` 截止:${utcToTZ(t.due_date, config.timezone)}${overdue}` : '';
  const tags = t.tags ? ` [${t.tags}]` : '';
  return `  ${t.id}. ${STATUS_LABEL[t.status] ?? t.status} ${pri} ${t.title}${tags}${due}  (创建时间: ${utcToTZ(t.created_at, config.timezone)})`;
}

/** 将待办列表打印到控制台，若为空则提示无结果 */
function printTodos(rows) {
  if (rows.length === 0) {
    console.log('没有找到待办事项。');
    return;
  }
  console.log(`\n待办事项（共 ${rows.length} 条）:\n`);
  for (const t of rows) {
    console.log(formatRow(t));
  }
  console.log();
}

// ── 验证 due_date 格式 ────────────────────────────────────────────────────────
/** 验证 --due 参数格式（"YYYY-MM-DD HH:mm:ss"），格式不合法时退出进程，合法则原样返回，null 直接返回 */
function validateDue(due) {
  if (!due) return null;
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(due)) {
    console.error('错误：--due 必须使用 "YYYY-MM-DD HH:mm:ss" 格式。');
    process.exit(1);
  }
  return due;
}

// ── CSV 工具函数 ──────────────────────────────────────────────────────────────
const CSV_COLUMNS = ['id', 'title', 'status', 'priority', 'tags', 'due_date', 'created_at'];

/** 将字段值转义为 CSV 安全字符串：含逗号、双引号或换行时用双引号包裹 */
function csvEscape(val) {
  const s = val == null ? '' : String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** 将数据库行数组序列化为 CSV 字符串（含表头），时间字段保持 UTC 原值 */
function toCSV(rows) {
  const header = CSV_COLUMNS.join(',');
  const lines = rows.map(r =>
    CSV_COLUMNS.map(c => csvEscape(r[c])).join(',')
  );
  return [header, ...lines].join('\n') + '\n';
}

/** 解析 CSV 文本为对象数组，key 来自第一行表头。支持双引号包裹、转义双引号、字段内换行 */
function parseCSV(text) {
  const rows = [];
  let headers = null;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const fields = [];
    // 解析一行的所有字段
    while (i < len) {
      if (text[i] === '"') {
        // 带引号的字段
        i++; // skip opening quote
        let val = '';
        while (i < len) {
          if (text[i] === '"') {
            if (i + 1 < len && text[i + 1] === '"') {
              val += '"';
              i += 2;
            } else {
              i++; // skip closing quote
              break;
            }
          } else {
            val += text[i];
            i++;
          }
        }
        fields.push(val);
        // skip comma or line ending
        if (i < len && text[i] === ',') { i++; }
        else if (i < len && text[i] === '\r') { i++; if (i < len && text[i] === '\n') i++; break; }
        else if (i < len && text[i] === '\n') { i++; break; }
      } else {
        // 不带引号的字段
        let val = '';
        while (i < len && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') {
          val += text[i];
          i++;
        }
        fields.push(val);
        if (i < len && text[i] === ',') { i++; }
        else if (i < len && text[i] === '\r') { i++; if (i < len && text[i] === '\n') i++; break; }
        else if (i < len && text[i] === '\n') { i++; break; }
      }
    }
    // 跳过空行（仅在末尾）
    if (fields.length === 1 && fields[0] === '' && i >= len) break;
    if (!headers) {
      headers = fields;
    } else {
      const obj = {};
      for (let j = 0; j < headers.length; j++) {
        obj[headers[j]] = j < fields.length ? fields[j] : '';
      }
      rows.push(obj);
    }
  }
  return rows;
}

// ── 各命令实现 ────────────────────────────────────────────────────────────────

/** add 命令：新增一条待办，支持 --priority、--tags、--due */
function cmdAdd(flags, positional) {
  const title = positional[0];
  if (!title) {
    console.error('错误：标题不能为空。\n  用法：add "标题" [--priority=low|medium|high] [--tags=标签1,标签2] [--due="YYYY-MM-DD HH:mm:ss"]');
    process.exit(1);
  }
  const priority = flags.priority ?? 'medium';
  if (!['low', 'medium', 'high'].includes(priority)) {
    console.error('错误：--priority 必须为 low、medium 或 high。');
    process.exit(1);
  }
  const tags = flags.tags ?? '';
  const rawDue = validateDue(flags.due ?? null);
  const due_date = rawDue ? tzToUTC(rawDue, config.timezone) : null;

  const stmt = db.prepare(
    'INSERT INTO todos (title, priority, tags, due_date) VALUES (?, ?, ?, ?)'
  );
  const result = stmt.run(title, priority, tags, due_date);
  const row = db.prepare('SELECT * FROM todos WHERE id = ?').get(result.lastInsertRowid);
  console.log('\n已添加:\n');
  console.log(formatRow(row));
  console.log();
}

/** list 命令：按条件查询并展示待办列表，支持 --status、--priority、--tag、--search、--due-before、--due-after */
function cmdList(flags) {
  const status = flags.status ?? 'pending';
  if (!['pending', 'done', 'all'].includes(status)) {
    console.error('错误：--status 必须为 pending、done 或 all。');
    process.exit(1);
  }
  if (flags.priority && !['low', 'medium', 'high'].includes(flags.priority)) {
    console.error('错误：--priority 必须为 low、medium 或 high。');
    process.exit(1);
  }
  const conditions = [];
  const params = [];

  if (status !== 'all') {
    conditions.push('status = ?');
    params.push(status);
  }
  if (flags.priority) {
    conditions.push('priority = ?');
    params.push(flags.priority);
  }
  if (flags.tag) {
    // 在逗号分隔的标签列表中匹配标签
    conditions.push("(',' || tags || ',' LIKE ?)");
    params.push(`%,${flags.tag},%`);
  }
  if (flags.search) {
    conditions.push('title LIKE ?');
    params.push(`%${flags.search}%`);
  }
  if (flags['due-before']) {
    validateDue(flags['due-before']);
    conditions.push('due_date <= ?');
    params.push(tzToUTC(flags['due-before'], config.timezone));
  }
  if (flags['due-after']) {
    validateDue(flags['due-after']);
    conditions.push('due_date >= ?');
    params.push(tzToUTC(flags['due-after'], config.timezone));
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM todos ${where} ORDER BY
    CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
    CASE WHEN due_date IS NULL THEN 1 ELSE 0 END,
    due_date ASC,
    id ASC`).all(...params);

  printTodos(rows);
}

/** done 命令：将指定 id 的待办标记为已完成 */
function cmdDone(positional) {
  const id = Number(positional[0]);
  if (!Number.isInteger(id) || id <= 0) {
    console.error('错误：需要有效的待办 id。\n  用法：done <id>');
    process.exit(1);
  }
  const existing = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
  if (!existing) {
    console.error(`错误：未找到待办 #${id}。`);
    process.exit(1);
  }
  db.prepare("UPDATE todos SET status = 'done' WHERE id = ?").run(id);
  const row = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
  console.log('\n已标记为完成:\n');
  console.log(formatRow(row));
  console.log();
}

/** delete 命令：永久删除指定 id 的待办 */
function cmdDelete(positional) {
  const id = Number(positional[0]);
  if (!Number.isInteger(id) || id <= 0) {
    console.error('错误：需要有效的待办 id。\n  用法：delete <id>');
    process.exit(1);
  }
  const existing = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
  if (!existing) {
    console.error(`错误：未找到待办 #${id}。`);
    process.exit(1);
  }
  db.prepare('DELETE FROM todos WHERE id = ?').run(id);
  console.log(`\n已删除待办 #${id}："${existing.title}"\n`);
}

/** update 命令：更新指定 id 待办的字段，支持 --title、--priority、--tags、--due */
function cmdUpdate(positional, flags) {
  const id = Number(positional[0]);
  if (!Number.isInteger(id) || id <= 0) {
    console.error('错误：需要有效的待办 id。\n  用法：update <id> [--title=...] [--priority=...] [--tags=...] [--due="YYYY-MM-DD HH:mm:ss"]');
    process.exit(1);
  }
  const existing = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
  if (!existing) {
    console.error(`错误：未找到待办 #${id}。`);
    process.exit(1);
  }

  const updates = [];
  const params = [];

  if (flags.title !== undefined) {
    if (!flags.title) {
      console.error('错误：--title 不能为空字符串。');
      process.exit(1);
    }
    updates.push('title = ?');
    params.push(flags.title);
  }
  if (flags.priority !== undefined) {
    if (!['low', 'medium', 'high'].includes(flags.priority)) {
      console.error('错误：--priority 必须为 low、medium 或 high。');
      process.exit(1);
    }
    updates.push('priority = ?');
    params.push(flags.priority);
  }
  if (flags.tags !== undefined) {
    updates.push('tags = ?');
    params.push(flags.tags);
  }
  if (flags.due !== undefined) {
    const rawDue = validateDue(flags.due === 'null' ? null : flags.due);
    const due = rawDue ? tzToUTC(rawDue, config.timezone) : null;
    updates.push('due_date = ?');
    params.push(due);
  }

  if (updates.length === 0) {
    console.log('没有可更新的内容。请使用 --title、--priority、--tags 或 --due。');
    process.exit(0);
  }

  params.push(id);
  db.prepare(`UPDATE todos SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  const row = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
  console.log('\n已更新:\n');
  console.log(formatRow(row));
  console.log();
}

/** config 命令：查看或更新本地配置（时区、数据版本） */
function cmdConfig(flags) {
  if (flags.timezone !== undefined) {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: flags.timezone });
    } catch {
      console.error(`错误："${flags.timezone}" 不是有效的 IANA 时区标识符。\n  示例：Asia/Shanghai、America/New_York、Europe/London、UTC`);
      process.exit(1);
    }
    config.timezone = flags.timezone;
    saveConfig(config);
    console.log(`\n时区已更新为：${flags.timezone}\n`);
    return;
  }
  console.log('\n当前配置：\n');
  console.log(JSON.stringify(config, null, 2));
  console.log();
}

/** export 命令：将待办数据导出为 CSV 文件 */
function cmdExport(flags) {
  const status = flags.status ?? 'all';
  if (!['pending', 'done', 'all'].includes(status)) {
    console.error('错误：--status 必须为 pending、done 或 all。');
    process.exit(1);
  }
  const conditions = [];
  const params = [];
  if (status !== 'all') {
    conditions.push('status = ?');
    params.push(status);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM todos ${where} ORDER BY id ASC`).all(...params);

  const csv = toCSV(rows);

  let filePath;
  if (flags.file) {
    filePath = resolve(flags.file);
  } else {
    // 自动生成文件名：todos-YYYYMMDD-HHmmss.csv（UTC）
    const now = new Date();
    const p = v => String(v).padStart(2, '0');
    const ts = `${now.getUTCFullYear()}${p(now.getUTCMonth()+1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
    filePath = join(DATA_DIR, `todos-${ts}.csv`);
  }

  writeFileSync(filePath, csv, 'utf8');
  console.log(`\n已导出 ${rows.length} 条待办到：${filePath}\n`);
}

/** import 命令：从 CSV 文件导入待办数据，导入前校验字段兼容性 */
function cmdImport(flags) {
  if (!flags.file) {
    console.error('错误：需要指定 CSV 文件路径。\n  用法：import --file=<路径>');
    process.exit(1);
  }
  const filePath = resolve(flags.file);
  if (!existsSync(filePath)) {
    console.error(`错误：文件不存在：${filePath}`);
    process.exit(1);
  }

  const text = readFileSync(filePath, 'utf8');
  const rows = parseCSV(text);

  if (rows.length === 0) {
    console.log('CSV 文件中没有数据行。');
    return;
  }

  // 表头校验：必须包含 title 列
  const headers = Object.keys(rows[0]);
  if (!headers.includes('title')) {
    console.error('错误：CSV 文件缺少必要字段：title。导入已取消。');
    process.exit(1);
  }

  // 逐行校验
  const errors = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const line = i + 2; // CSV 行号（第1行是表头，数据从第2行开始）
    if (!row.title || row.title.trim() === '') {
      errors.push(`第 ${line} 行：title 不能为空。`);
    }
    if (row.status !== undefined && row.status !== '' && !['pending', 'done'].includes(row.status)) {
      errors.push(`第 ${line} 行：status 必须为 pending 或 done，当前值："${row.status}"。`);
    }
    if (row.priority !== undefined && row.priority !== '' && !['low', 'medium', 'high'].includes(row.priority)) {
      errors.push(`第 ${line} 行：priority 必须为 low、medium 或 high，当前值："${row.priority}"。`);
    }
    if (row.due_date !== undefined && row.due_date !== '') {
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row.due_date)) {
        errors.push(`第 ${line} 行：due_date 必须使用 "YYYY-MM-DD HH:mm:ss" 格式，当前值："${row.due_date}"。`);
      }
    }
  }

  if (errors.length > 0) {
    console.error('错误：CSV 数据校验失败，导入已取消。\n');
    for (const e of errors) {
      console.error(`  ${e}`);
    }
    process.exit(1);
  }

  // 校验通过，执行导入
  const stmt = db.prepare(
    'INSERT INTO todos (title, status, priority, tags, due_date) VALUES (?, ?, ?, ?, ?)'
  );
  for (const row of rows) {
    const title = row.title;
    const status = row.status || 'pending';
    const priority = row.priority || 'medium';
    const tags = row.tags ?? '';
    const due_date = row.due_date || null;
    stmt.run(title, status, priority, tags, due_date);
  }

  console.log(`\n已导入 ${rows.length} 条待办。\n`);
}

// ── 程序入口 ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const { positional, flags } = parseArgs(args);
const [cmd, ...rest] = positional;

switch (cmd) {
  case 'add':
    cmdAdd(flags, rest);
    break;
  case 'list':
    cmdList(flags);
    break;
  case 'done':
    cmdDone(rest);
    break;
  case 'delete':
  case 'del':
  case 'rm':
    cmdDelete(rest);
    break;
  case 'update':
  case 'edit':
    cmdUpdate(rest, flags);
    break;
  case 'config':
    cmdConfig(flags);
    break;
  case 'export':
    cmdExport(flags);
    break;
  case 'import':
    cmdImport(flags);
    break;
  default:
    console.log(`
待办事项技能脚本
用法：
  node todos.mjs add "标题" [--priority=low|medium|high] [--tags=标签1,标签2] [--due="YYYY-MM-DD HH:mm:ss"]
  node todos.mjs list [--status=pending|done|all] [--priority=low|medium|high] [--tag=标签名] [--search=关键字] [--due-before="YYYY-MM-DD HH:mm:ss"] [--due-after="YYYY-MM-DD HH:mm:ss"]
  node todos.mjs done <id>
  node todos.mjs delete <id>
  node todos.mjs update <id> [--title="新标题"] [--priority=low|medium|high] [--tags=标签1,标签2] [--due="YYYY-MM-DD HH:mm:ss"]
  node todos.mjs export [--file=<路径>] [--status=pending|done|all]
  node todos.mjs import --file=<路径>
  node todos.mjs config [--timezone=<IANA时区>]

数据存储路径：${DB_PATH}
当前时区：${config.timezone}
`);
}
