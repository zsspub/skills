#!/usr/bin/env node
// @version 1.0.0
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

// ── 数据路径：{skill_install_dir}/../.data/zsspub/habits/data.sqlite ──
const SKILL_DIR = resolve(import.meta.dirname, '..');
const DATA_DIR = join(SKILL_DIR, '..', '.data', 'zsspub', 'checkin');
const DB_PATH = process.env.HABITS_DB_PATH ?? join(DATA_DIR, 'data.sqlite');
const CONFIG_PATH = process.env.HABITS_CONFIG_PATH ?? join(DATA_DIR, 'config.json');

const DATA_VERSION = '1.0.0';

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

// ── 配置加载 ──────────────────────────────────────────────────────────────────
const config = loadConfig();
const db = new DatabaseSync(DB_PATH);

// ── 数据库结构 ────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS checkins (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    topic            TEXT    NOT NULL,
    tags             TEXT    NOT NULL DEFAULT '',
    duration_minutes INTEGER,
    note             TEXT    NOT NULL DEFAULT '',
    raw_input        TEXT    NOT NULL DEFAULT '',
    checked_at       TEXT    NOT NULL,
    created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now'))
  )
`);

// ── 数据迁移 ──────────────────────────────────────────────────────────────────
runMigrations(config, db);

// ── 参数解析器 ───────────────────────────────────────────────────────────────
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

// ── 辅助函数 ──────────────────────────────────────────────────────────────────

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

function saveConfig(cfg) {
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

const MIGRATIONS = {};

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

function tzToUTC(localStr, tz) {
  const [dp, tp] = localStr.split(' ');
  const [y, mo, d] = dp.split('-').map(Number);
  const [h, mi, s] = tp.split(':').map(Number);
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

function getNowUTCStr() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function formatDuration(minutes) {
  if (minutes == null) return '';
  if (minutes < 60) return `${minutes}分钟`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}小时${m}分钟` : `${h}小时`;
}

function formatRow(r) {
  const dur = r.duration_minutes != null ? ` ⏱${formatDuration(r.duration_minutes)}` : '';
  const tags = r.tags ? ` [${r.tags}]` : '';
  const note = r.note ? ` 📝${r.note}` : '';
  const raw = r.raw_input ? ` 💬${r.raw_input}` : '';
  const checkedAt = utcToTZ(r.checked_at, config.timezone);
  return `  ${r.id}. 📌 ${r.topic}${tags}${dur}${note}${raw}  (${checkedAt})`;
}

function printCheckins(rows) {
  if (rows.length === 0) {
    console.log('没有找到打卡记录。');
    return;
  }
  console.log(`\n打卡记录（共 ${rows.length} 条）:\n`);
  for (const r of rows) {
    console.log(formatRow(r));
  }
  console.log();
}

function validateDatetime(val, label) {
  if (!val) return null;
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(val)) {
    console.error(`错误：${label} 必须使用 "YYYY-MM-DD HH:mm:ss" 格式。`);
    process.exit(1);
  }
  return val;
}

function validateDate(val, label) {
  if (!val) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    console.error(`错误：${label} 必须使用 "YYYY-MM-DD" 格式。`);
    process.exit(1);
  }
  return val;
}

// ── CSV 工具函数 ──────────────────────────────────────────────────────────────
const CSV_COLUMNS = ['id', 'topic', 'tags', 'duration_minutes', 'note', 'raw_input', 'checked_at', 'created_at'];

function csvEscape(val) {
  const s = val == null ? '' : String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toCSV(rows) {
  const header = CSV_COLUMNS.join(',');
  const lines = rows.map(r =>
    CSV_COLUMNS.map(c => csvEscape(r[c])).join(',')
  );
  return [header, ...lines].join('\n') + '\n';
}

function parseCSV(text) {
  const rows = [];
  let headers = null;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const fields = [];
    while (i < len) {
      if (text[i] === '"') {
        i++;
        let val = '';
        while (i < len) {
          if (text[i] === '"') {
            if (i + 1 < len && text[i + 1] === '"') {
              val += '"';
              i += 2;
            } else {
              i++;
              break;
            }
          } else {
            val += text[i];
            i++;
          }
        }
        fields.push(val);
        if (i < len && text[i] === ',') { i++; }
        else if (i < len && text[i] === '\r') { i++; if (i < len && text[i] === '\n') i++; break; }
        else if (i < len && text[i] === '\n') { i++; break; }
      } else {
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

function cmdAdd(flags, positional) {
  const topic = positional[0];
  if (!topic) {
    console.error('错误：主题不能为空。\n  用法：add "主题" --raw="用户原话" [--tags=标签1,标签2] [--duration=分钟数] [--note="备注"] [--at="YYYY-MM-DD HH:mm:ss"]');
    process.exit(1);
  }
  const tags = flags.tags ?? '';
  const durationRaw = flags.duration;
  let duration_minutes = null;
  if (durationRaw !== undefined) {
    duration_minutes = Number(durationRaw);
    if (!Number.isInteger(duration_minutes) || duration_minutes <= 0) {
      console.error('错误：--duration 必须为正整数（单位：分钟）。');
      process.exit(1);
    }
  }
  const note = flags.note ?? '';
  const raw_input = flags.raw;
  if (!raw_input) {
    console.error('错误：--raw 参数为必填项，请传入用户的原始输入。\n  用法：add "主题" --raw="用户原话" [--tags=标签1,标签2] [--duration=分钟数] [--note="备注"] [--at="YYYY-MM-DD HH:mm:ss"]');
    process.exit(1);
  }
  const rawAt = validateDatetime(flags.at ?? null, '--at');
  const checked_at = rawAt ? tzToUTC(rawAt, config.timezone) : getNowUTCStr();

  const stmt = db.prepare(
    'INSERT INTO checkins (topic, tags, duration_minutes, note, raw_input, checked_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const result = stmt.run(topic, tags, duration_minutes, note, raw_input, checked_at);
  const row = db.prepare('SELECT * FROM checkins WHERE id = ?').get(result.lastInsertRowid);
  console.log('\n已打卡:\n');
  console.log(formatRow(row));
  console.log();
}

function cmdList(flags) {
  const conditions = [];
  const params = [];

  if (flags.topic) {
    conditions.push('topic LIKE ?');
    params.push(`%${flags.topic}%`);
  }
  if (flags.tag) {
    conditions.push("(',' || tags || ',' LIKE ?)");
    params.push(`%,${flags.tag},%`);
  }
  if (flags.date) {
    validateDate(flags.date, '--date');
    // 将 date 范围转换为 UTC 进行查询
    const dayStart = tzToUTC(`${flags.date} 00:00:00`, config.timezone);
    const dayEnd = tzToUTC(`${flags.date} 23:59:59`, config.timezone);
    conditions.push('checked_at >= ? AND checked_at <= ?');
    params.push(dayStart, dayEnd);
  }
  if (flags.from) {
    validateDatetime(flags.from, '--from');
    conditions.push('checked_at >= ?');
    params.push(tzToUTC(flags.from, config.timezone));
  }
  if (flags.to) {
    validateDatetime(flags.to, '--to');
    conditions.push('checked_at <= ?');
    params.push(tzToUTC(flags.to, config.timezone));
  }
  if (flags.search) {
    conditions.push('(topic LIKE ? OR note LIKE ?)');
    params.push(`%${flags.search}%`, `%${flags.search}%`);
  }

  const limit = flags.limit ? Number(flags.limit) : null;

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  let sql = `SELECT * FROM checkins ${where} ORDER BY checked_at DESC, id DESC`;
  if (limit && Number.isInteger(limit) && limit > 0) {
    sql += ` LIMIT ${limit}`;
  }
  const rows = db.prepare(sql).all(...params);
  printCheckins(rows);
}

function cmdUpdate(positional, flags) {
  const id = Number(positional[0]);
  if (!Number.isInteger(id) || id <= 0) {
    console.error('错误：需要有效的打卡 id。\n  用法：update <id> [--topic=...] [--tags=...] [--duration=...] [--note=...] [--at="YYYY-MM-DD HH:mm:ss"]');
    process.exit(1);
  }
  const existing = db.prepare('SELECT * FROM checkins WHERE id = ?').get(id);
  if (!existing) {
    console.error(`错误：未找到打卡记录 #${id}。`);
    process.exit(1);
  }

  const updates = [];
  const params = [];

  if (flags.topic !== undefined) {
    if (!flags.topic) {
      console.error('错误：--topic 不能为空字符串。');
      process.exit(1);
    }
    updates.push('topic = ?');
    params.push(flags.topic);
  }
  if (flags.tags !== undefined) {
    updates.push('tags = ?');
    params.push(flags.tags);
  }
  if (flags.duration !== undefined) {
    if (flags.duration === 'null') {
      updates.push('duration_minutes = ?');
      params.push(null);
    } else {
      const dur = Number(flags.duration);
      if (!Number.isInteger(dur) || dur <= 0) {
        console.error('错误：--duration 必须为正整数（单位：分钟），或 "null" 以清除。');
        process.exit(1);
      }
      updates.push('duration_minutes = ?');
      params.push(dur);
    }
  }
  if (flags.note !== undefined) {
    updates.push('note = ?');
    params.push(flags.note);
  }
  if (flags.at !== undefined) {
    const rawAt = validateDatetime(flags.at === 'null' ? null : flags.at, '--at');
    const at = rawAt ? tzToUTC(rawAt, config.timezone) : getNowUTCStr();
    updates.push('checked_at = ?');
    params.push(at);
  }

  if (updates.length === 0) {
    console.log('没有可更新的内容。请使用 --topic、--tags、--duration、--note 或 --at。');
    process.exit(0);
  }

  params.push(id);
  db.prepare(`UPDATE checkins SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  const row = db.prepare('SELECT * FROM checkins WHERE id = ?').get(id);
  console.log('\n已更新:\n');
  console.log(formatRow(row));
  console.log();
}

function cmdDelete(positional) {
  const id = Number(positional[0]);
  if (!Number.isInteger(id) || id <= 0) {
    console.error('错误：需要有效的打卡 id。\n  用法：delete <id>');
    process.exit(1);
  }
  const existing = db.prepare('SELECT * FROM checkins WHERE id = ?').get(id);
  if (!existing) {
    console.error(`错误：未找到打卡记录 #${id}。`);
    process.exit(1);
  }
  db.prepare('DELETE FROM checkins WHERE id = ?').run(id);
  console.log(`\n已删除打卡记录 #${id}："${existing.topic}"\n`);
}

function cmdStats(flags) {
  const conditions = [];
  const params = [];

  if (flags.topic) {
    conditions.push('topic LIKE ?');
    params.push(`%${flags.topic}%`);
  }
  if (flags.tag) {
    conditions.push("(',' || tags || ',' LIKE ?)");
    params.push(`%,${flags.tag},%`);
  }
  if (flags.from) {
    validateDatetime(flags.from, '--from');
    conditions.push('checked_at >= ?');
    params.push(tzToUTC(flags.from, config.timezone));
  }
  if (flags.to) {
    validateDatetime(flags.to, '--to');
    conditions.push('checked_at <= ?');
    params.push(tzToUTC(flags.to, config.timezone));
  }
  // 快捷时间范围
  if (flags.period) {
    const now = new Date();
    let fromDate;
    switch (flags.period) {
      case 'today': {
        const todayStr = utcToTZ(getNowUTCStr(), config.timezone).split(' ')[0];
        const dayStart = tzToUTC(`${todayStr} 00:00:00`, config.timezone);
        const dayEnd = tzToUTC(`${todayStr} 23:59:59`, config.timezone);
        conditions.push('checked_at >= ? AND checked_at <= ?');
        params.push(dayStart, dayEnd);
        break;
      }
      case 'week': {
        const todayStr = utcToTZ(getNowUTCStr(), config.timezone).split(' ')[0];
        const [y, mo, d] = todayStr.split('-').map(Number);
        const today = new Date(y, mo - 1, d);
        const dayOfWeek = today.getDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const monday = new Date(y, mo - 1, d + mondayOffset);
        const p = v => String(v).padStart(2, '0');
        const fromStr = `${monday.getFullYear()}-${p(monday.getMonth()+1)}-${p(monday.getDate())} 00:00:00`;
        conditions.push('checked_at >= ?');
        params.push(tzToUTC(fromStr, config.timezone));
        break;
      }
      case 'month': {
        const todayStr = utcToTZ(getNowUTCStr(), config.timezone).split(' ')[0];
        const [y, mo] = todayStr.split('-').map(Number);
        const p = v => String(v).padStart(2, '0');
        const fromStr = `${y}-${p(mo)}-01 00:00:00`;
        conditions.push('checked_at >= ?');
        params.push(tzToUTC(fromStr, config.timezone));
        break;
      }
      case 'year': {
        const todayStr = utcToTZ(getNowUTCStr(), config.timezone).split(' ')[0];
        const y = todayStr.split('-')[0];
        const fromStr = `${y}-01-01 00:00:00`;
        conditions.push('checked_at >= ?');
        params.push(tzToUTC(fromStr, config.timezone));
        break;
      }
      default:
        console.error('错误：--period 必须为 today、week、month 或 year。');
        process.exit(1);
    }
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // 总打卡次数
  const total = db.prepare(`SELECT COUNT(*) as cnt FROM checkins ${where}`).get(...params);

  // 总时长
  const durSum = db.prepare(`SELECT SUM(duration_minutes) as total_min FROM checkins ${where}`).get(...params);

  // 按主题统计
  const byTopic = db.prepare(
    `SELECT topic, COUNT(*) as cnt, SUM(duration_minutes) as total_min FROM checkins ${where} GROUP BY topic ORDER BY cnt DESC`
  ).all(...params);

  // 按标签统计（需要拆分逗号分隔的标签）
  const allRows = db.prepare(`SELECT tags, duration_minutes FROM checkins ${where}`).all(...params);
  const tagMap = {};
  for (const row of allRows) {
    if (!row.tags) continue;
    for (const tag of row.tags.split(',')) {
      const t = tag.trim();
      if (!t) continue;
      if (!tagMap[t]) tagMap[t] = { cnt: 0, total_min: 0 };
      tagMap[t].cnt++;
      if (row.duration_minutes != null) tagMap[t].total_min += row.duration_minutes;
    }
  }
  const byTag = Object.entries(tagMap)
    .map(([tag, v]) => ({ tag, ...v }))
    .sort((a, b) => b.cnt - a.cnt);

  console.log('\n📊 打卡统计:\n');
  console.log(`  总打卡次数：${total.cnt}`);
  console.log(`  总时长：${formatDuration(durSum.total_min) || '无记录'}`);

  if (byTopic.length > 0) {
    console.log('\n  按主题：');
    for (const t of byTopic) {
      const dur = t.total_min != null ? ` (${formatDuration(t.total_min)})` : '';
      console.log(`    ${t.topic}：${t.cnt} 次${dur}`);
    }
  }

  if (byTag.length > 0) {
    console.log('\n  按标签：');
    for (const t of byTag) {
      const dur = t.total_min > 0 ? ` (${formatDuration(t.total_min)})` : '';
      console.log(`    ${t.tag}：${t.cnt} 次${dur}`);
    }
  }
  console.log();
}

function cmdStreak(flags) {
  const topic = flags.topic ?? null;
  const tag = flags.tag ?? null;

  const conditions = [];
  const params = [];
  if (topic) {
    conditions.push('topic LIKE ?');
    params.push(`%${topic}%`);
  }
  if (tag) {
    conditions.push("(',' || tags || ',' LIKE ?)");
    params.push(`%,${tag},%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(
    `SELECT checked_at FROM checkins ${where} ORDER BY checked_at ASC`
  ).all(...params);

  if (rows.length === 0) {
    console.log('没有找到打卡记录，无法计算连续天数。');
    return;
  }

  // 将所有打卡时间转换为本地日期，去重
  const dateSet = new Set();
  for (const r of rows) {
    const localDate = utcToTZ(r.checked_at, config.timezone).split(' ')[0];
    dateSet.add(localDate);
  }
  const dates = [...dateSet].sort();

  // 计算当前连续天数（从今天往回数）
  const todayStr = utcToTZ(getNowUTCStr(), config.timezone).split(' ')[0];

  let currentStreak = 0;
  let checkDate = todayStr;

  // 如果今天没有打卡，从昨天开始检查
  if (!dateSet.has(todayStr)) {
    const yesterday = new Date(todayStr);
    yesterday.setDate(yesterday.getDate() - 1);
    const p = v => String(v).padStart(2, '0');
    checkDate = `${yesterday.getFullYear()}-${p(yesterday.getMonth()+1)}-${p(yesterday.getDate())}`;
  }

  while (dateSet.has(checkDate)) {
    currentStreak++;
    const prev = new Date(checkDate);
    prev.setDate(prev.getDate() - 1);
    const p = v => String(v).padStart(2, '0');
    checkDate = `${prev.getFullYear()}-${p(prev.getMonth()+1)}-${p(prev.getDate())}`;
  }

  // 计算最长连续天数
  let maxStreak = 0;
  let streak = 1;
  for (let i = 1; i < dates.length; i++) {
    const prevDate = new Date(dates[i - 1]);
    const currDate = new Date(dates[i]);
    const diffDays = (currDate - prevDate) / (1000 * 60 * 60 * 24);
    if (diffDays === 1) {
      streak++;
    } else {
      maxStreak = Math.max(maxStreak, streak);
      streak = 1;
    }
  }
  maxStreak = Math.max(maxStreak, streak);

  const label = topic ? ` (${topic})` : tag ? ` (${tag})` : '';
  console.log(`\n🔥 连续打卡${label}:\n`);
  console.log(`  当前连续：${currentStreak} 天${!dateSet.has(todayStr) && currentStreak > 0 ? '（今天还未打卡）' : ''}`);
  console.log(`  最长连续：${maxStreak} 天`);
  console.log(`  累计打卡：${dates.length} 天`);
  console.log();
}

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

function cmdExport(flags) {
  const conditions = [];
  const params = [];
  if (flags.topic) {
    conditions.push('topic LIKE ?');
    params.push(`%${flags.topic}%`);
  }
  if (flags.tag) {
    conditions.push("(',' || tags || ',' LIKE ?)");
    params.push(`%,${flags.tag},%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM checkins ${where} ORDER BY id ASC`).all(...params);

  const csv = toCSV(rows);

  let filePath;
  if (flags.file) {
    filePath = resolve(flags.file);
  } else {
    const now = new Date();
    const p = v => String(v).padStart(2, '0');
    const ts = `${now.getUTCFullYear()}${p(now.getUTCMonth()+1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
    filePath = join(DATA_DIR, `habits-${ts}.csv`);
  }

  writeFileSync(filePath, csv, 'utf8');
  console.log(`\n已导出 ${rows.length} 条打卡记录到：${filePath}\n`);
}

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

  const headers = Object.keys(rows[0]);
  if (!headers.includes('topic')) {
    console.error('错误：CSV 文件缺少必要字段：topic。导入已取消。');
    process.exit(1);
  }

  const errors = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const line = i + 2;
    if (!row.topic || row.topic.trim() === '') {
      errors.push(`第 ${line} 行：topic 不能为空。`);
    }
    if (row.duration_minutes !== undefined && row.duration_minutes !== '') {
      const dur = Number(row.duration_minutes);
      if (!Number.isInteger(dur) || dur <= 0) {
        errors.push(`第 ${line} 行：duration_minutes 必须为正整数，当前值："${row.duration_minutes}"。`);
      }
    }
    if (row.checked_at !== undefined && row.checked_at !== '') {
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row.checked_at)) {
        errors.push(`第 ${line} 行：checked_at 必须使用 "YYYY-MM-DD HH:mm:ss" 格式，当前值："${row.checked_at}"。`);
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

  const stmt = db.prepare(
    'INSERT INTO checkins (topic, tags, duration_minutes, note, raw_input, checked_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const row of rows) {
    const topic = row.topic;
    const tags = row.tags ?? '';
    const duration_minutes = row.duration_minutes ? Number(row.duration_minutes) : null;
    const note = row.note ?? '';
    const raw_input = row.raw_input ?? '';
    const checked_at = row.checked_at || getNowUTCStr();
    stmt.run(topic, tags, duration_minutes, note, raw_input, checked_at);
  }

  console.log(`\n已导入 ${rows.length} 条打卡记录。\n`);
}

// ── 主入口 ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const command = args[0];
const rest = args.slice(1);
const { positional, flags } = parseArgs(rest);

switch (command) {
  case 'add':
    cmdAdd(flags, positional);
    break;
  case 'list':
  case 'ls':
    cmdList(flags);
    break;
  case 'update':
  case 'edit':
    cmdUpdate(positional, flags);
    break;
  case 'delete':
  case 'del':
  case 'rm':
    cmdDelete(positional);
    break;
  case 'stats':
    cmdStats(flags);
    break;
  case 'streak':
    cmdStreak(flags);
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
    console.error(`未知命令：${command ?? '(空)'}\n可用命令：add, list, update, delete, stats, streak, config, export, import`);
    process.exit(1);
}
