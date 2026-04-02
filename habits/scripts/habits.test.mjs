/**
 * habits.mjs 集成测试
 * 运行方式：node --no-warnings --test scripts/checkin.test.mjs
 *
 * 使用 Node.js 内置 node:test + node:assert，无需任何第三方依赖。
 * 每次测试通过 HABITS_DB_PATH 环境变量指向临时数据库，测试结束后自动清理。
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./habits.mjs', import.meta.url));

function makeTmpEnv() {
  const dir = mkdtempSync(join(tmpdir(), 'habits-test-'));
  const env = {
    ...process.env,
    HABITS_DB_PATH: join(dir, 'test.sqlite'),
    HABITS_CONFIG_PATH: join(dir, 'config.json'),
  };
  return { dir, env };
}

function run(env, ...args) {
  const result = spawnSync(
    process.execPath,
    ['--no-warnings', SCRIPT, ...args],
    { encoding: 'utf8', env },
  );
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 0,
  };
}

// ── add 命令 ──────────────────────────────────────────────────────────────────
describe('add 命令', () => {
  let env, dir;
  before(() => ({ dir, env } = makeTmpEnv()));
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('基本添加（仅主题）', () => {
    const { stdout, status } = run(env, 'add', '骑行', '--raw=测试');
    assert.equal(status, 0);
    assert.match(stdout, /已打卡/);
    assert.match(stdout, /骑行/);
  });

  test('添加带标签和时长', () => {
    const { stdout, status } = run(env, 'add', '跑步', '--tags=运动', '--duration=40', '--raw=测试');
    assert.equal(status, 0);
    assert.match(stdout, /跑步/);
    assert.match(stdout, /\[运动\]/);
    assert.match(stdout, /40分钟/);
  });

  test('添加带备注', () => {
    const { stdout, status } = run(env, 'add', '阅读', '--tags=学习', '--note=《原则》第三章', '--raw=测试');
    assert.equal(status, 0);
    assert.match(stdout, /阅读/);
    assert.match(stdout, /📝《原则》第三章/);
  });

  test('添加带原话', () => {
    const { stdout, status } = run(env, 'add', '骑行', '--tags=运动', '--duration=30', '--raw=打卡骑行 30 分钟');
    assert.equal(status, 0);
    assert.match(stdout, /💬打卡骑行 30 分钟/);
  });

  test('添加带打卡时间', () => {
    const { stdout, status } = run(env, 'add', '冥想', '--at=2026-04-01 08:00:00', '--raw=测试');
    assert.equal(status, 0);
    assert.match(stdout, /冥想/);
  });

  test('主题为空时报错', () => {
    const { stderr, status } = run(env, 'add', '--raw=测试');
    assert.notEqual(status, 0);
    assert.match(stderr, /主题不能为空/);
  });

  test('无效时长报错', () => {
    const { stderr, status } = run(env, 'add', '骑行', '--duration=abc', '--raw=测试');
    assert.notEqual(status, 0);
    assert.match(stderr, /正整数/);
  });

  test('时长为零报错', () => {
    const { stderr, status } = run(env, 'add', '骑行', '--duration=0', '--raw=测试');
    assert.notEqual(status, 0);
    assert.match(stderr, /正整数/);
  });

  test('打卡时间格式错误报错', () => {
    const { stderr, status } = run(env, 'add', '骑行', '--at=2026/04/01', '--raw=测试');
    assert.notEqual(status, 0);
    assert.match(stderr, /YYYY-MM-DD HH:mm:ss/);
  });

  test('缺少 --raw 报错', () => {
    const { stderr, status } = run(env, 'add', '骑行');
    assert.notEqual(status, 0);
    assert.match(stderr, /--raw/);
  });
});

// ── list 命令 ─────────────────────────────────────────────────────────────────
describe('list 命令', () => {
  let env, dir;
  before(() => {
    ({ dir, env } = makeTmpEnv());
    run(env, 'add', '骑行', '--tags=运动', '--duration=30', '--at=2026-04-02 10:00:00', '--raw=测试');
    run(env, 'add', '阅读', '--tags=学习', '--note=第一章', '--at=2026-04-02 20:00:00', '--raw=测试');
    run(env, 'add', '跑步', '--tags=运动', '--duration=45', '--at=2026-04-01 18:00:00', '--raw=测试');
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('列出所有记录', () => {
    const { stdout, status } = run(env, 'list');
    assert.equal(status, 0);
    assert.match(stdout, /共 3 条/);
  });

  test('按主题筛选', () => {
    const { stdout, status } = run(env, 'list', '--topic=骑行');
    assert.equal(status, 0);
    assert.match(stdout, /骑行/);
    assert.match(stdout, /共 1 条/);
  });

  test('按标签筛选', () => {
    const { stdout, status } = run(env, 'list', '--tag=运动');
    assert.equal(status, 0);
    assert.match(stdout, /共 2 条/);
  });

  test('按日期筛选', () => {
    const { stdout, status } = run(env, 'list', '--date=2026-04-02');
    assert.equal(status, 0);
    assert.match(stdout, /共 2 条/);
  });

  test('搜索关键字', () => {
    const { stdout, status } = run(env, 'list', '--search=第一章');
    assert.equal(status, 0);
    assert.match(stdout, /阅读/);
  });

  test('限制返回条数', () => {
    const { stdout, status } = run(env, 'list', '--limit=1');
    assert.equal(status, 0);
    assert.match(stdout, /共 1 条/);
  });

  test('别名 ls', () => {
    const { stdout, status } = run(env, 'ls');
    assert.equal(status, 0);
    assert.match(stdout, /共 3 条/);
  });
});

// ── update 命令 ───────────────────────────────────────────────────────────────
describe('update 命令', () => {
  let env, dir;
  before(() => {
    ({ dir, env } = makeTmpEnv());
    run(env, 'add', '骑行', '--tags=运动', '--duration=30', '--raw=测试');
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('更新时长', () => {
    const { stdout, status } = run(env, 'update', '1', '--duration=45');
    assert.equal(status, 0);
    assert.match(stdout, /已更新/);
    assert.match(stdout, /45分钟/);
  });

  test('更新主题', () => {
    const { stdout, status } = run(env, 'update', '1', '--topic=公路骑行');
    assert.equal(status, 0);
    assert.match(stdout, /公路骑行/);
  });

  test('更新备注', () => {
    const { stdout, status } = run(env, 'update', '1', '--note=环湖一圈');
    assert.equal(status, 0);
    assert.match(stdout, /📝环湖一圈/);
  });

  test('清除时长', () => {
    const { stdout, status } = run(env, 'update', '1', '--duration=null');
    assert.equal(status, 0);
    assert.match(stdout, /已更新/);
    assert.doesNotMatch(stdout, /⏱/);
  });

  test('ID 不存在报错', () => {
    const { stderr, status } = run(env, 'update', '999', '--topic=test');
    assert.notEqual(status, 0);
    assert.match(stderr, /未找到/);
  });

  test('无效 ID 报错', () => {
    const { stderr, status } = run(env, 'update', 'abc');
    assert.notEqual(status, 0);
    assert.match(stderr, /有效的打卡 id/);
  });

  test('无更新内容', () => {
    const { stdout, status } = run(env, 'update', '1');
    assert.equal(status, 0);
    assert.match(stdout, /没有可更新的内容/);
  });

  test('别名 edit', () => {
    const { stdout, status } = run(env, 'edit', '1', '--note=测试别名');
    assert.equal(status, 0);
    assert.match(stdout, /已更新/);
  });
});

// ── delete 命令 ───────────────────────────────────────────────────────────────
describe('delete 命令', () => {
  let env, dir;
  before(() => {
    ({ dir, env } = makeTmpEnv());
    run(env, 'add', '骑行', '--tags=运动', '--raw=测试');
    run(env, 'add', '跑步', '--tags=运动', '--raw=测试');
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('删除记录', () => {
    const { stdout, status } = run(env, 'delete', '1');
    assert.equal(status, 0);
    assert.match(stdout, /已删除/);
    assert.match(stdout, /骑行/);
  });

  test('ID 不存在报错', () => {
    const { stderr, status } = run(env, 'delete', '999');
    assert.notEqual(status, 0);
    assert.match(stderr, /未找到/);
  });

  test('别名 del', () => {
    const { stdout, status } = run(env, 'del', '2');
    assert.equal(status, 0);
    assert.match(stdout, /已删除/);
  });
});

// ── stats 命令 ────────────────────────────────────────────────────────────────
describe('stats 命令', () => {
  let env, dir;
  before(() => {
    ({ dir, env } = makeTmpEnv());
    run(env, 'add', '骑行', '--tags=运动', '--duration=30', '--at=2026-04-02 10:00:00', '--raw=测试');
    run(env, 'add', '跑步', '--tags=运动', '--duration=45', '--at=2026-04-02 18:00:00', '--raw=测试');
    run(env, 'add', '阅读', '--tags=学习', '--duration=60', '--at=2026-04-02 21:00:00', '--raw=测试');
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('全量统计', () => {
    const { stdout, status } = run(env, 'stats');
    assert.equal(status, 0);
    assert.match(stdout, /总打卡次数：3/);
    assert.match(stdout, /2小时15分钟/);
  });

  test('按主题筛选统计', () => {
    const { stdout, status } = run(env, 'stats', '--topic=骑行');
    assert.equal(status, 0);
    assert.match(stdout, /总打卡次数：1/);
    assert.match(stdout, /30分钟/);
  });

  test('按标签筛选统计', () => {
    const { stdout, status } = run(env, 'stats', '--tag=运动');
    assert.equal(status, 0);
    assert.match(stdout, /总打卡次数：2/);
    assert.match(stdout, /1小时15分钟/);
  });
});

// ── streak 命令 ───────────────────────────────────────────────────────────────
describe('streak 命令', () => {
  let env, dir;
  before(() => {
    ({ dir, env } = makeTmpEnv());
    // 连续 3 天打卡
    run(env, 'add', '骑行', '--tags=运动', '--at=2026-03-31 10:00:00', '--raw=测试');
    run(env, 'add', '骑行', '--tags=运动', '--at=2026-04-01 10:00:00', '--raw=测试');
    run(env, 'add', '骑行', '--tags=运动', '--at=2026-04-02 10:00:00', '--raw=测试');
    // 另一个主题只有 1 天
    run(env, 'add', '阅读', '--tags=学习', '--at=2026-04-02 20:00:00', '--raw=测试');
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('全部连续打卡', () => {
    const { stdout, status } = run(env, 'streak');
    assert.equal(status, 0);
    assert.match(stdout, /累计打卡：3 天/);
  });

  test('按主题看连续打卡', () => {
    const { stdout, status } = run(env, 'streak', '--topic=骑行');
    assert.equal(status, 0);
    assert.match(stdout, /最长连续：3 天/);
    assert.match(stdout, /累计打卡：3 天/);
  });

  test('无记录时提示', () => {
    const { stdout, status } = run(env, 'streak', '--topic=游泳');
    assert.equal(status, 0);
    assert.match(stdout, /没有找到打卡记录/);
  });
});

// ── config 命令 ───────────────────────────────────────────────────────────────
describe('config 命令', () => {
  let env, dir;
  before(() => ({ dir, env } = makeTmpEnv()));
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('查看默认配置', () => {
    const { stdout, status } = run(env, 'config');
    assert.equal(status, 0);
    assert.match(stdout, /UTC/);
  });

  test('设置时区', () => {
    const { stdout, status } = run(env, 'config', '--timezone=Asia/Shanghai');
    assert.equal(status, 0);
    assert.match(stdout, /Asia\/Shanghai/);
  });

  test('设置后配置已更新', () => {
    const { stdout, status } = run(env, 'config');
    assert.equal(status, 0);
    assert.match(stdout, /Asia\/Shanghai/);
  });

  test('无效时区报错', () => {
    const { stderr, status } = run(env, 'config', '--timezone=Invalid/Zone');
    assert.notEqual(status, 0);
    assert.match(stderr, /不是有效的 IANA 时区标识符/);
  });
});

// ── export 命令 ───────────────────────────────────────────────────────────────
describe('export 命令', () => {
  let env, dir;
  before(() => {
    ({ dir, env } = makeTmpEnv());
    run(env, 'add', '骑行', '--tags=运动', '--duration=30', '--raw=打卡骑行30分钟');
    run(env, 'add', '阅读', '--tags=学习', '--note=第一章', '--raw=读了第一章');
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('导出所有记录', () => {
    const outFile = join(dir, 'export.csv');
    const { stdout, status } = run(env, 'export', `--file=${outFile}`);
    assert.equal(status, 0);
    assert.match(stdout, /已导出 2 条/);
    const csv = readFileSync(outFile, 'utf8');
    assert.match(csv, /topic/);
    assert.match(csv, /骑行/);
    assert.match(csv, /阅读/);
  });

  test('按主题筛选导出', () => {
    const outFile = join(dir, 'export-topic.csv');
    const { stdout, status } = run(env, 'export', `--file=${outFile}`, '--topic=骑行');
    assert.equal(status, 0);
    assert.match(stdout, /已导出 1 条/);
    const csv = readFileSync(outFile, 'utf8');
    assert.match(csv, /骑行/);
    assert.doesNotMatch(csv, /阅读/);
  });

  test('按标签筛选导出', () => {
    const outFile = join(dir, 'export-tag.csv');
    const { stdout, status } = run(env, 'export', `--file=${outFile}`, '--tag=学习');
    assert.equal(status, 0);
    assert.match(stdout, /已导出 1 条/);
  });

  test('自动生成文件名', () => {
    const { stdout, status } = run(env, 'export');
    assert.equal(status, 0);
    assert.match(stdout, /已导出 2 条/);
    assert.match(stdout, /habits-.*\.csv/);
  });
});

// ── import 命令 ───────────────────────────────────────────────────────────────
describe('import 命令', () => {
  let env, dir;
  before(() => ({ dir, env } = makeTmpEnv()));
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('导入 CSV 文件', () => {
    const csvFile = join(dir, 'import.csv');
    writeFileSync(csvFile, 'topic,tags,duration_minutes,note,raw_input,checked_at\n骑行,运动,30,环湖,打卡骑行,2026-04-02 10:00:00\n阅读,学习,,第一章,读书,2026-04-02 20:00:00\n', 'utf8');
    const { stdout, status } = run(env, 'import', `--file=${csvFile}`);
    assert.equal(status, 0);
    assert.match(stdout, /已导入 2 条/);

    const { stdout: listOut } = run(env, 'list');
    assert.match(listOut, /共 2 条/);
  });

  test('缺少 --file 报错', () => {
    const { stderr, status } = run(env, 'import');
    assert.notEqual(status, 0);
    assert.match(stderr, /需要指定/);
  });

  test('文件不存在报错', () => {
    const { stderr, status } = run(env, 'import', '--file=/tmp/nonexistent.csv');
    assert.notEqual(status, 0);
    assert.match(stderr, /不存在/);
  });

  test('缺少 topic 列报错', () => {
    const csvFile = join(dir, 'bad-header.csv');
    writeFileSync(csvFile, 'name,tags\n骑行,运动\n', 'utf8');
    const { stderr, status } = run(env, 'import', `--file=${csvFile}`);
    assert.notEqual(status, 0);
    assert.match(stderr, /topic/);
  });

  test('topic 为空报错', () => {
    const csvFile = join(dir, 'empty-topic.csv');
    writeFileSync(csvFile, 'topic,tags\n,运动\n', 'utf8');
    const { stderr, status } = run(env, 'import', `--file=${csvFile}`);
    assert.notEqual(status, 0);
    assert.match(stderr, /topic 不能为空/);
  });

  test('无效 duration_minutes 报错', () => {
    const csvFile = join(dir, 'bad-duration.csv');
    writeFileSync(csvFile, 'topic,duration_minutes\n骑行,abc\n', 'utf8');
    const { stderr, status } = run(env, 'import', `--file=${csvFile}`);
    assert.notEqual(status, 0);
    assert.match(stderr, /duration_minutes/);
  });
});

// ── 未知命令 ──────────────────────────────────────────────────────────────────
describe('未知命令', () => {
  let env, dir;
  before(() => ({ dir, env } = makeTmpEnv()));
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('未知命令报错', () => {
    const { stderr, status } = run(env, 'unknown');
    assert.notEqual(status, 0);
    assert.match(stderr, /未知命令/);
  });

  test('无命令报错', () => {
    const { stderr, status } = run(env);
    assert.notEqual(status, 0);
    assert.match(stderr, /未知命令/);
  });
});
