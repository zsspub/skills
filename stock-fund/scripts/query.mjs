#!/usr/bin/env node

/**
 * A 股行情 & 基金估值查询脚本
 *
 * 用法：
 *   node query.mjs fund <基金代码> [...]          # 查询基金估值
 *   node query.mjs fund search <关键词>           # 按名称搜索基金
 *   node query.mjs stock <sh/sz代码> [...]        # 查询股票/指数行情
 *   node query.mjs stock search <关键词>          # 按名称搜索股票
 *
 * 股票代码格式：sh600519, sz002460, sh000001
 */

const args = process.argv.slice(2);

if (args.length === 0) {
  console.log(`用法：
  node query.mjs fund <基金代码> [...]        查询基金估值
  node query.mjs fund search <关键词>         按名称搜索基金
  node query.mjs stock <代码> [...]           查询股票/指数行情
  node query.mjs stock search <关键词>        按名称搜索股票

示例：
  node query.mjs fund 110022 005827
  node query.mjs fund search 医疗
  node query.mjs stock sh600519 sz002460
  node query.mjs stock search 赣锋锂业`);
  process.exit(0);
}

const fmtPct = (val) => {
  const v = parseFloat(val);
  if (isNaN(v)) return String(val);
  const icon = v > 0 ? '🔴' : v < 0 ? '🟢' : '⬜';
  return `${icon} ${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
};

const fmtVol = (v) => {
  if (v >= 1e8) return (v / 1e8).toFixed(2) + ' 亿';
  if (v >= 1e4) return (v / 1e4).toFixed(2) + ' 万';
  return String(v);
};

const fmtAmt = (v) => {
  if (v >= 1e12) return (v / 1e12).toFixed(2) + ' 万亿';
  if (v >= 1e8) return (v / 1e8).toFixed(2) + ' 亿';
  if (v >= 1e4) return (v / 1e4).toFixed(2) + ' 万';
  return String(v);
};

// ===================== 基金 =====================

async function fundSearch(keyword) {
  const url = `http://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(keyword)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const data = JSON.parse(await res.text());
  const funds = (data.Datas || []).filter((d) => d.CATEGORYDESC === '基金');
  if (funds.length === 0) {
    console.log(`未找到与「${keyword}」匹配的基金`);
    return;
  }
  console.log(`\n搜索「${keyword}」找到 ${funds.length} 只基金：\n`);
  console.log('  代码\t\t名称\t\t\t\t类型');
  console.log('  ' + '-'.repeat(60));
  for (const f of funds) {
    const ftype = (f.FundBaseInfo || {}).FTYPE || '';
    console.log(`  ${f.CODE}\t\t${f.NAME}\t\t${ftype}`);
  }
  const json = funds.map((f) => ({ code: f.CODE, name: f.NAME, type: (f.FundBaseInfo || {}).FTYPE || '' }));
  console.log('\n--- JSON ---');
  console.log(JSON.stringify(json, null, 2));
}

async function fundQuery(codes) {
  async function queryOne(code) {
    const url = `http://fundgz.1234567.com.cn/js/${code}.js`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return { error: `请求失败 (${res.status})`, code };
      const text = await res.text();
      const match = text.match(/jsonpgz\((.+)\)/);
      if (!match) return { error: `无效的基金代码：${code}`, code };
      return JSON.parse(match[1]);
    } catch (err) {
      return { error: `查询失败：${err.message}`, code };
    }
  }

  const results = await Promise.all(codes.map(queryOne));
  for (const data of results) {
    if (data.error) { console.log(`❌ ${data.error}`); continue; }
    console.log(`\n${'='.repeat(40)}`);
    console.log(`  ${data.name} (${data.fundcode})`);
    console.log(`${'='.repeat(40)}`);
    console.log(`  上期净值：  ${data.dwjz} 元  (${data.jzrq})`);
    console.log(`  估算净值：  ${data.gsz} 元`);
    if (data.gszzl != null) console.log(`  估算涨幅：  ${fmtPct(data.gszzl)}`);
    console.log(`  估值时间：  ${data.gztime}`);
    console.log();
  }
  console.log('--- JSON ---');
  console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
}

// ===================== 股票 =====================

async function stockSearch(keyword) {
  const url = `http://smartbox.gtimg.cn/s3/?q=${encodeURIComponent(keyword)}&t=all`;
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10000) });
  const buf = await res.arrayBuffer();
  const text = new TextDecoder('gbk').decode(buf);
  // v_hint="sz~002460~赣锋锂业~gfly~GP-A^hk~01772~赣锋锂业~gfly~GP"
  const match = text.match(/v_hint="(.*)"/);
  if (!match || !match[1]) {
    console.log(`未找到与「${keyword}」匹配的股票`);
    return;
  }
  const items = match[1].split('^').map((s) => {
    const [market, code, name, pinyin, type] = s.split('~');
    return { market, code, name, pinyin, type };
  }).filter((item) => item.market === 'sh' || item.market === 'sz');

  if (items.length === 0) {
    console.log(`未找到 A 股中与「${keyword}」匹配的股票`);
    return;
  }
  console.log(`\n搜索「${keyword}」找到 ${items.length} 只 A 股：\n`);
  console.log('  代码\t\t名称\t\t\t类型');
  console.log('  ' + '-'.repeat(50));
  for (const item of items) {
    console.log(`  ${item.market}${item.code}\t\t${item.name}\t\t${item.type}`);
  }
  console.log('\n--- JSON ---');
  console.log(JSON.stringify(items.map(({ market, code, name, type }) => ({
    symbol: `${market}${code}`, name, type,
  })), null, 2));
}

async function stockQuery(symbols) {
  const qStr = symbols.join(',');
  const url = `http://qt.gtimg.cn/q=${qStr}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const buf = await res.arrayBuffer();
  const text = new TextDecoder('gbk').decode(buf);

  // 每行: v_sh600519="1~贵州茅台~600519~1460.00~..."
  const lines = text.split(';').filter((l) => l.includes('='));
  const results = [];

  for (const line of lines) {
    const m = line.match(/v_(\w+)="(.*)"/);
    if (!m) continue;
    const fields = m[2].split('~');
    if (fields.length < 50) continue;

    const data = {
      symbol: m[1],
      name: fields[1],
      code: fields[2],
      price: parseFloat(fields[3]),
      prevClose: parseFloat(fields[4]),
      open: parseFloat(fields[5]),
      volume: parseInt(fields[6]),         // 手
      change: parseFloat(fields[31]),
      changePct: parseFloat(fields[32]),
      high: parseFloat(fields[33]),
      low: parseFloat(fields[34]),
      amount: parseFloat(fields[37]),      // 万元
      turnover: parseFloat(fields[38]),    // %
      time: fields[30],
      type: fields[61],
    };

    console.log(`\n${'='.repeat(40)}`);
    console.log(`  ${data.name} (${data.symbol})`);
    console.log(`${'='.repeat(40)}`);
    console.log(`  最新价：    ${data.price}`);
    console.log(`  涨跌额：    ${data.change > 0 ? '+' : ''}${data.change}`);
    console.log(`  涨跌幅：    ${fmtPct(data.changePct)}`);
    console.log(`  开盘：      ${data.open}`);
    console.log(`  最高/最低： ${data.high} / ${data.low}`);
    console.log(`  昨收：      ${data.prevClose}`);
    console.log(`  成交量：    ${fmtVol(data.volume)} 手`);
    console.log(`  成交额：    ${fmtAmt(data.amount * 10000)} 元`);
    if (data.turnover) console.log(`  换手率：    ${data.turnover}%`);
    console.log();
    results.push(data);
  }

  if (results.length === 0) {
    console.log('❌ 未查询到有效数据，请检查代码格式（如 sh600519, sz002460）');
    return;
  }
  console.log('--- JSON ---');
  console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
}

// ===================== 路由 =====================

const cmd = args[0];
const rest = args.slice(1);

try {
  if (cmd === 'fund') {
    if (rest[0] === 'search') {
      const kw = rest.slice(1).join(' ');
      if (!kw) { console.log('请提供搜索关键词'); process.exit(1); }
      await fundSearch(kw);
    } else if (rest.length > 0) {
      await fundQuery(rest);
    } else {
      console.log('请提供基金代码，如：node query.mjs fund 110022');
    }
  } else if (cmd === 'stock') {
    if (rest[0] === 'search') {
      const kw = rest.slice(1).join(' ');
      if (!kw) { console.log('请提供搜索关键词'); process.exit(1); }
      await stockSearch(kw);
    } else if (rest.length > 0) {
      await stockQuery(rest);
    } else {
      console.log('请提供股票代码，如：node query.mjs stock sh600519');
    }
  } else {
    console.log(`未知命令: ${cmd}，可用命令: fund, stock`);
    process.exit(1);
  }
} catch (err) {
  console.error(`操作失败：${err.message}`);
  process.exit(1);
}
