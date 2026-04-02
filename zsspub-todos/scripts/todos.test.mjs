/**
 * todos.mjs 集成测试
 * 运行方式：node --no-warnings --test scripts/todos.test.mjs
 *
 * 使用 Node.js 内置 node:test + node:assert，无需任何第三方依赖。
 * 每次测试通过 TODO_DB_PATH 环境变量指向临时数据库，测试结束后自动清理。
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// ── 常量 ──────────────────────────────────────────────────────────────────────
const SCRIPT = fileURLToPath(new URL('./todos.mjs', import.meta.url));

// ── 临时数据库（每个 describe 块独立隔离）────────────────────────────────────
function makeTmpEnv() {
  const dir = mkdtempSync(join(tmpdir(), 'todos-test-'));
  const env = {
    ...process.env,
    TODO_DB_PATH: join(dir, 'test.sqlite'),
    TODO_CONFIG_PATH: join(dir, 'config.json'),
  };
  return { dir, env };
}

/** 运行脚本并返回 { stdout, stderr, status } */
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

  test('基本添加（默认优先级）', () => {
    const { stdout, status } = run(env, 'add', '买菜');
    assert.equal(status, 0);
    assert.match(stdout, /已添加/);
    assert.match(stdout, /买菜/);
    assert.match(stdout, /🟡/); // medium
  });

  test('指定优先级 high', () => {
    const { stdout, status } = run(env, 'add', '紧急任务', '--priority=high');
    assert.equal(status, 0);
    assert.match(stdout, /🔴/);
  });

  test('指定优先级 low', () => {
    const { stdout, status } = run(env, 'add', '低优先级任务', '--priority=low');
    assert.equal(status, 0);
    assert.match(stdout, /🟢/);
  });

  test('指定标签', () => {
    const { stdout, status } = run(env, 'add', '工作任务', '--tags=工作,项目');
    assert.equal(status, 0);
    assert.match(stdout, /\[工作,项目\]/);
  });

  test('指定截止日期', () => {
    const { stdout, status } = run(env, 'add', '有截止日期的任务', '--due=2026-12-31 18:00:00');
    assert.equal(status, 0);
    assert.match(stdout, /截止:2026-12-31 18:00:00/);
  });

  test('标题为空时报错并退出非零', () => {
    const { stderr, status } = run(env, 'add');
    assert.notEqual(status, 0);
    assert.match(stderr, /标题不能为空/);
  });

  test('无效优先级时报错并退出非零', () => {
    const { stderr, status } = run(env, 'add', '任务', '--priority=invalid');
    assert.notEqual(status, 0);
    assert.match(stderr, /low、medium 或 high/);
  });

  test('截止日期格式错误时报错并退出非零', () => {
    const { stderr, status } = run(env, 'add', '任务', '--due=2026/12/31');
    assert.notEqual(status, 0);
    assert.match(stderr, /YYYY-MM-DD HH:mm:ss/);
  });
});

// ── list 命令 ─────────────────────────────────────────────────────────────────
describe('list 命令', () => {
  let env, dir;

  before(() => {
    ({ dir, env } = makeTmpEnv());
    // 准备测试数据
    run(env, 'add', '待完成任务A', '--priority=high', '--tags=工作');
    run(env, 'add', '待完成任务B', '--priority=low', '--tags=个人');
    run(env, 'add', '有截止的任务', '--due=2026-06-01 12:00:00');
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('默认只列出 pending 任务', () => {
    const { stdout, status } = run(env, 'list');
    assert.equal(status, 0);
    assert.match(stdout, /待完成任务A/);
    assert.match(stdout, /待完成任务B/);
  });

  test('空库时提示没有找到', () => {
    const { dir: d2, env: e2 } = makeTmpEnv();
    try {
      const { stdout, status } = run(e2, 'list');
      assert.equal(status, 0);
      assert.match(stdout, /没有找到/);
    } finally {
      rmSync(d2, { recursive: true, force: true });
    }
  });

  test('按优先级筛选', () => {
    const { stdout } = run(env, 'list', '--priority=high');
    assert.match(stdout, /待完成任务A/);
    assert.doesNotMatch(stdout, /待完成任务B/);
  });

  test('按标签筛选', () => {
    const { stdout } = run(env, 'list', '--tag=个人');
    assert.match(stdout, /待完成任务B/);
    assert.doesNotMatch(stdout, /待完成任务A/);
  });

  test('按截止日期筛选（due-before）', () => {
    const { stdout } = run(env, 'list', '--due-before=2026-07-01 00:00:00');
    assert.match(stdout, /有截止的任务/);
  });

  test('--status=all 包含所有状态', () => {
    // 将任务A完成
    const listResult = run(env, 'list', '--priority=high');
    const idMatch = listResult.stdout.match(/(\d+)\.\s+\[\s*\]/);
    if (idMatch) {
      run(env, 'done', idMatch[1]);
    }
    const { stdout } = run(env, 'list', '--status=all');
    // all 模式下已完成和待完成都应显示
    assert.match(stdout, /待办事项/);
  });

  test('无效 --status 值时报错', () => {
    const { stderr, status } = run(env, 'list', '--status=invalid');
    assert.notEqual(status, 0);
    assert.match(stderr, /pending、done 或 all/);
  });

  test('无效 --priority 值时报错', () => {
    const { stderr, status } = run(env, 'list', '--priority=超高');
    assert.notEqual(status, 0);
    assert.match(stderr, /low、medium 或 high/);
  });

  test('--search 按关键字筛选', () => {
    const { dir: d, env: e } = makeTmpEnv();
    try {
      run(e, 'add', '提交季度报告');
      run(e, 'add', '买菜');
      const { stdout, status } = run(e, 'list', '--search=报告');
      assert.equal(status, 0);
      assert.match(stdout, /提交季度报告/);
      assert.doesNotMatch(stdout, /买菜/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('--search 无匹配时提示没有找到', () => {
    const { dir: d, env: e } = makeTmpEnv();
    try {
      run(e, 'add', '买菜');
      const { stdout, status } = run(e, 'list', '--search=不存在的关键字');
      assert.equal(status, 0);
      assert.match(stdout, /没有找到/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('过期任务显示 ⚠️已过期 标注', () => {
    const { dir: d, env: e } = makeTmpEnv();
    try {
      run(e, 'add', '过期任务', '--due=2020-01-01 00:00:00');
      run(e, 'add', '未来任务', '--due=2099-12-31 23:59:59');
      const { stdout } = run(e, 'list');
      assert.match(stdout, /⚠️已过期/);
      // 未来任务不应显示过期标注
      const futureLineMatch = stdout.match(/未来任务.*/);
      if (futureLineMatch) {
        assert.doesNotMatch(futureLineMatch[0], /⚠️已过期/);
      }
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('已完成的过期任务不显示 ⚠️已过期', () => {
    const { dir: d, env: e } = makeTmpEnv();
    try {
      run(e, 'add', '完成的过期任务', '--due=2020-01-01 00:00:00');
      const id = run(e, 'list').stdout.match(/(\d+)\./)?.[1];
      run(e, 'done', id);
      const { stdout } = run(e, 'list', '--status=done');
      assert.doesNotMatch(stdout, /⚠️已过期/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

// ── done 命令 ─────────────────────────────────────────────────────────────────
describe('done 命令', () => {
  let env, dir;
  before(() => ({ dir, env } = makeTmpEnv()));
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('将任务标记为完成', () => {
    run(env, 'add', '待完成的任务');
    const listOut = run(env, 'list').stdout;
    const id = listOut.match(/(\d+)\./)?.[1];
    assert.ok(id, '应能找到任务 id');

    const { stdout, status } = run(env, 'done', id);
    assert.equal(status, 0);
    assert.match(stdout, /已标记为完成/);
    assert.match(stdout, /\[x\]/);
  });

  test('id 不存在时报错', () => {
    const { stderr, status } = run(env, 'done', '9999');
    assert.notEqual(status, 0);
    assert.match(stderr, /未找到待办/);
  });

  test('无效 id 时报错', () => {
    const { stderr, status } = run(env, 'done', 'abc');
    assert.notEqual(status, 0);
    assert.match(stderr, /有效的待办 id/);
  });
});

// ── delete 命令 ───────────────────────────────────────────────────────────────
describe('delete 命令', () => {
  let env, dir;
  before(() => ({ dir, env } = makeTmpEnv()));
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('删除任务', () => {
    run(env, 'add', '待删除的任务');
    const id = run(env, 'list').stdout.match(/(\d+)\./)?.[1];
    assert.ok(id);

    const { stdout, status } = run(env, 'delete', id);
    assert.equal(status, 0);
    assert.match(stdout, /已删除待办/);

    // 确认已删除
    const after = run(env, 'list').stdout;
    assert.doesNotMatch(after, /待删除的任务/);
  });

  test('别名 del 可用', () => {
    run(env, 'add', '用别名删除的任务');
    const id = run(env, 'list').stdout.match(/(\d+)\./)?.[1];
    const { status } = run(env, 'del', id);
    assert.equal(status, 0);
  });

  test('别名 rm 可用', () => {
    run(env, 'add', '用rm别名删除的任务');
    const id = run(env, 'list').stdout.match(/(\d+)\./)?.[1];
    const { status } = run(env, 'rm', id);
    assert.equal(status, 0);
  });

  test('id 不存在时报错', () => {
    const { stderr, status } = run(env, 'delete', '9999');
    assert.notEqual(status, 0);
    assert.match(stderr, /未找到待办/);
  });
});

// ── update 命令 ───────────────────────────────────────────────────────────────
describe('update 命令', () => {
  let env, dir;
  before(() => ({ dir, env } = makeTmpEnv()));
  after(() => rmSync(dir, { recursive: true, force: true }));

  function addAndGetId(title) {
    run(env, 'add', title);
    const out = run(env, 'list').stdout;
    return out.match(/(\d+)\./)?.[1];
  }

  test('更新标题', () => {
    const id = addAndGetId('原始标题');
    const { stdout, status } = run(env, 'update', id, '--title=新标题');
    assert.equal(status, 0);
    assert.match(stdout, /新标题/);
  });

  test('更新优先级', () => {
    const id = addAndGetId('优先级测试');
    const { stdout, status } = run(env, 'update', id, '--priority=high');
    assert.equal(status, 0);
    assert.match(stdout, /🔴/);
  });

  test('更新标签', () => {
    const id = addAndGetId('标签测试');
    const { stdout, status } = run(env, 'update', id, '--tags=新标签');
    assert.equal(status, 0);
    assert.match(stdout, /\[新标签\]/);
  });

  test('更新截止日期', () => {
    const id = addAndGetId('截止日期测试');
    const { stdout, status } = run(env, 'update', id, '--due=2027-01-01 09:00:00');
    assert.equal(status, 0);
    assert.match(stdout, /截止:2027-01-01 09:00:00/);
  });

  test('清除截止日期（--due=null）', () => {
    const id = addAndGetId('清除截止日期');
    run(env, 'update', id, '--due=2027-01-01 09:00:00');
    const { stdout, status } = run(env, 'update', id, '--due=null');
    assert.equal(status, 0);
    assert.doesNotMatch(stdout, /截止:/);
  });

  test('无更新字段时提示', () => {
    const id = addAndGetId('无更新字段');
    const { stdout, status } = run(env, 'update', id);
    assert.equal(status, 0);
    assert.match(stdout, /没有可更新的内容/);
  });

  test('别名 edit 可用', () => {
    const id = addAndGetId('edit别名测试');
    const { status } = run(env, 'edit', id, '--title=edit别名更新');
    assert.equal(status, 0);
  });

  test('id 不存在时报错', () => {
    const { stderr, status } = run(env, 'update', '9999', '--title=x');
    assert.notEqual(status, 0);
    assert.match(stderr, /未找到待办/);
  });

  test('无效优先级时报错', () => {
    const id = addAndGetId('无效优先级');
    const { stderr, status } = run(env, 'update', id, '--priority=超高');
    assert.notEqual(status, 0);
    assert.match(stderr, /low、medium 或 high/);
  });

  test('--title 为空字符串时报错', () => {
    const id = addAndGetId('空标题测试');
    const { stderr, status } = run(env, 'update', id, '--title=');
    assert.notEqual(status, 0);
    assert.match(stderr, /不能为空字符串/);
  });
});

// ── 未知命令 ──────────────────────────────────────────────────────────────────
describe('未知命令', () => {
  let env, dir;
  before(() => ({ dir, env } = makeTmpEnv()));
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('无命令时打印帮助信息', () => {
    const { stdout, status } = run(env);
    assert.equal(status, 0);
    assert.match(stdout, /待办事项技能脚本/);
    assert.match(stdout, /用法/);
  });

  test('无效命令时打印帮助信息', () => {
    const { stdout, status } = run(env, 'invalid-cmd');
    assert.equal(status, 0);
    assert.match(stdout, /待办事项技能脚本/);
  });
});

// ── export 命令 ───────────────────────────────────────────────────────────────
describe('export 命令', () => {
  let env, dir;
  before(() => ({ dir, env } = makeTmpEnv()));
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('空数据库导出仅含表头', () => {
    const csvPath = join(dir, 'empty.csv');
    const { stdout, status } = run(env, 'export', `--file=${csvPath}`);
    assert.equal(status, 0);
    assert.match(stdout, /已导出 0 条/);
    const content = readFileSync(csvPath, 'utf8');
    assert.match(content, /^id,title,status,priority,tags,due_date,created_at\n$/);
  });

  test('导出多条待办数据正确', () => {
    run(env, 'add', '任务A', '--priority=high', '--tags=工作');
    run(env, 'add', '任务B', '--priority=low', '--due=2026-06-01 12:00:00');
    const csvPath = join(dir, 'todos.csv');
    const { stdout, status } = run(env, 'export', `--file=${csvPath}`);
    assert.equal(status, 0);
    assert.match(stdout, /已导出 2 条/);
    const content = readFileSync(csvPath, 'utf8');
    assert.match(content, /任务A/);
    assert.match(content, /任务B/);
    assert.match(content, /high/);
    assert.match(content, /工作/);
  });

  test('--status 筛选导出', () => {
    // 将任务A标记为完成
    const listOut = run(env, 'list', '--priority=high').stdout;
    const id = listOut.match(/(\d+)\./)?.[1];
    if (id) run(env, 'done', id);

    const csvPath = join(dir, 'pending-only.csv');
    const { stdout, status } = run(env, 'export', `--file=${csvPath}`, '--status=pending');
    assert.equal(status, 0);
    assert.match(stdout, /已导出 1 条/);
    const content = readFileSync(csvPath, 'utf8');
    assert.doesNotMatch(content, /任务A/);
    assert.match(content, /任务B/);
  });

  test('tags 含逗号时正确转义', () => {
    const { dir: d, env: e } = makeTmpEnv();
    try {
      run(e, 'add', '多标签任务', '--tags=工作,紧急,项目');
      const csvPath = join(d, 'tags.csv');
      run(e, 'export', `--file=${csvPath}`);
      const content = readFileSync(csvPath, 'utf8');
      // tags 含逗号应被双引号包裹
      assert.match(content, /"工作,紧急,项目"/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('不指定 --file 时自动生成文件名', () => {
    const { dir: d, env: e } = makeTmpEnv();
    try {
      run(e, 'add', '自动命名测试');
      const { stdout, status } = run(e, 'export');
      assert.equal(status, 0);
      assert.match(stdout, /已导出 1 条/);
      assert.match(stdout, /todos-\d{8}-\d{6}\.csv/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

// ── import 命令 ───────────────────────────────────────────────────────────────
describe('import 命令', () => {
  let env, dir;
  before(() => ({ dir, env } = makeTmpEnv()));
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('正常导入 CSV 并验证数据', () => {
    const csvPath = join(dir, 'import.csv');
    writeFileSync(csvPath, 'title,status,priority,tags,due_date\n导入任务A,pending,high,测试,2026-12-31 18:00:00\n导入任务B,done,low,,\n', 'utf8');
    const { stdout, status } = run(env, 'import', `--file=${csvPath}`);
    assert.equal(status, 0);
    assert.match(stdout, /已导入 2 条/);

    // 验证数据已插入
    const listOut = run(env, 'list', '--status=all').stdout;
    assert.match(listOut, /导入任务A/);
    assert.match(listOut, /导入任务B/);
  });

  test('缺少 title 列时报错退出', () => {
    const csvPath = join(dir, 'no-title.csv');
    writeFileSync(csvPath, 'status,priority\npending,high\n', 'utf8');
    const { stderr, status } = run(env, 'import', `--file=${csvPath}`);
    assert.notEqual(status, 0);
    assert.match(stderr, /缺少必要字段：title/);
  });

  test('title 为空值时报错退出', () => {
    const csvPath = join(dir, 'empty-title.csv');
    writeFileSync(csvPath, 'title,status\n,pending\n', 'utf8');
    const { stderr, status } = run(env, 'import', `--file=${csvPath}`);
    assert.notEqual(status, 0);
    assert.match(stderr, /title 不能为空/);
  });

  test('无效 status 值时报错退出', () => {
    const csvPath = join(dir, 'bad-status.csv');
    writeFileSync(csvPath, 'title,status\n任务X,invalid\n', 'utf8');
    const { stderr, status } = run(env, 'import', `--file=${csvPath}`);
    assert.notEqual(status, 0);
    assert.match(stderr, /status 必须为 pending 或 done/);
  });

  test('无效 priority 值时报错退出', () => {
    const csvPath = join(dir, 'bad-priority.csv');
    writeFileSync(csvPath, 'title,priority\n任务X,超高\n', 'utf8');
    const { stderr, status } = run(env, 'import', `--file=${csvPath}`);
    assert.notEqual(status, 0);
    assert.match(stderr, /priority 必须为 low、medium 或 high/);
  });

  test('无效 due_date 格式时报错退出', () => {
    const csvPath = join(dir, 'bad-due.csv');
    writeFileSync(csvPath, 'title,due_date\n任务X,2026/12/31\n', 'utf8');
    const { stderr, status } = run(env, 'import', `--file=${csvPath}`);
    assert.notEqual(status, 0);
    assert.match(stderr, /due_date 必须使用/);
  });

  test('仅含 title 列（最小 CSV）成功导入', () => {
    const { dir: d, env: e } = makeTmpEnv();
    try {
      const csvPath = join(d, 'minimal.csv');
      writeFileSync(csvPath, 'title\n最小导入任务\n', 'utf8');
      const { stdout, status } = run(e, 'import', `--file=${csvPath}`);
      assert.equal(status, 0);
      assert.match(stdout, /已导入 1 条/);
      // 验证默认值
      const listOut = run(e, 'list').stdout;
      assert.match(listOut, /最小导入任务/);
      assert.match(listOut, /🟡/); // medium priority
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('含多余列时忽略多余列，成功导入', () => {
    const { dir: d, env: e } = makeTmpEnv();
    try {
      const csvPath = join(d, 'extra-cols.csv');
      writeFileSync(csvPath, 'title,extra_col,priority\n多余列任务,忽略我,high\n', 'utf8');
      const { stdout, status } = run(e, 'import', `--file=${csvPath}`);
      assert.equal(status, 0);
      assert.match(stdout, /已导入 1 条/);
      const listOut = run(e, 'list').stdout;
      assert.match(listOut, /多余列任务/);
      assert.match(listOut, /🔴/); // high priority
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('未指定 --file 时报错', () => {
    const { stderr, status } = run(env, 'import');
    assert.notEqual(status, 0);
    assert.match(stderr, /需要指定 CSV 文件路径/);
  });

  test('文件不存在时报错', () => {
    const { stderr, status } = run(env, 'import', '--file=/nonexistent/file.csv');
    assert.notEqual(status, 0);
    assert.match(stderr, /文件不存在/);
  });

  test('原子性：部分行不合法时不导入任何数据', () => {
    const { dir: d, env: e } = makeTmpEnv();
    try {
      const csvPath = join(d, 'partial-bad.csv');
      writeFileSync(csvPath, 'title,status\n合法任务,pending\n非法任务,invalid\n', 'utf8');
      const { stderr, status } = run(e, 'import', `--file=${csvPath}`);
      assert.notEqual(status, 0);
      assert.match(stderr, /校验失败/);
      // 验证数据库中没有插入任何数据
      const listOut = run(e, 'list', '--status=all').stdout;
      assert.match(listOut, /没有找到/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

// ── export → import round-trip ───────────────────────────────────────────────
describe('export → import round-trip', () => {
  test('导出后重新导入，数据一致（除 id 和 created_at）', () => {
    const { dir: d1, env: e1 } = makeTmpEnv();
    const { dir: d2, env: e2 } = makeTmpEnv();
    try {
      // 在 d1 中添加数据
      run(e1, 'add', '任务甲', '--priority=high', '--tags=工作,紧急', '--due=2026-12-31 18:00:00');
      run(e1, 'add', '任务乙', '--priority=low');
      run(e1, 'add', '任务丙', '--due=2027-03-15 09:30:00');
      // 将任务乙标记完成
      const id = run(e1, 'list', '--priority=low').stdout.match(/(\d+)\./)?.[1];
      if (id) run(e1, 'done', id);

      // 导出
      const csvPath = join(d1, 'roundtrip.csv');
      run(e1, 'export', `--file=${csvPath}`);

      // 导入到 d2
      const { status } = run(e2, 'import', `--file=${csvPath}`);
      assert.equal(status, 0);

      // 验证 d2 中的数据与 d1 基本一致
      const list2 = run(e2, 'list', '--status=all').stdout;
      assert.match(list2, /任务甲/);
      assert.match(list2, /任务乙/);
      assert.match(list2, /任务丙/);
      assert.match(list2, /共 3 条/);
    } finally {
      rmSync(d1, { recursive: true, force: true });
      rmSync(d2, { recursive: true, force: true });
    }
  });
});
