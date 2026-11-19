/* 派工内控表导入回归：分类/状态映射/去重后缀/客户名单/版本刷新 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const base = path.join(__dirname, '..', 'work-order');
const read = f => JSON.parse(fs.readFileSync(path.join(base, f), 'utf8'));

let pass = 0, fail = 0;
function ok(name, fn) {
  try { const r = fn(); if (r === false) throw new Error('断言为 false'); pass++; console.log('  PASS ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ' :: ' + e.message); }
}

const wn = read('data_wn.json'), nw = read('data_nw.json'), u = read('data_u.json');
const all = wn.concat(nw, u);
const VER = 'kz-20261119-v1';

console.log('\n[1. 数据规模与版本]');
ok('总数 412', () => all.length === 412);
ok('保内 73', () => wn.length === 73);
ok('保外 125', () => nw.length === 125);
ok('未分类 214', () => u.length === 214);
ok('全部记录带版本号', () => all.every(o => o.dataVersion === VER));
ok('全部记录有 id 与 status', () => all.every(o => o.id && o.status));

console.log('\n[2. 分类规则]');
ok('保内全部含「保内」', () => wn.every(o => o.kType.indexOf('保内') >= 0));
ok('保外全部含「保外」', () => nw.every(o => o.kType.indexOf('保外') >= 0));
ok('未分类均不含保内/保外', () => u.every(o => o.kType.indexOf('保内') < 0 && o.kType.indexOf('保外') < 0));
ok('未分类含批改/非售后/站内', () => ['批改', '非售后', '站内'].every(k => u.some(o => o.kType.indexOf(k) >= 0)));

console.log('\n[3. 状态映射]');
const WN_OK = ['未派工', '已接单', '在修', '待质检终检', '驳回待重检', '已竣工', '已结算', '已结清', '已终止'];
const NW_OK = ['待客户确认', '报价确认', '在修', '待质检终检', '驳回待重检', '维修完成', '已关单', '已终止'];
ok('保内状态均属流程', () => wn.every(o => WN_OK.indexOf(o.status) >= 0));
ok('保外状态均属流程', () => nw.every(o => NW_OK.indexOf(o.status) >= 0));
ok('「待开始」保内→已接单', () => wn.filter(o => o.statusRaw === '待开始').every(o => o.status === '已接单'));
ok('「维修中-*」保内→在修', () => wn.filter(o => /^维修中/.test(o.statusRaw)).every(o => o.status === '在修'));
ok('「已完工」保内→已竣工', () => wn.filter(o => o.statusRaw === '已完工').every(o => o.status === '已竣工'));
ok('「已报单」保内→已结清', () => wn.filter(o => o.statusRaw === '已报单').every(o => o.status === '已结清'));
ok('「已报单」保外→已关单', () => nw.filter(o => o.statusRaw === '已报单').every(o => o.status === '已关单'));
ok('「终止/移交」→已终止', () => all.filter(o => o.statusRaw === '终止' || o.statusRaw === '移交').every(o => o.status === '已终止'));
ok('原始状态已留痕', () => all.filter(o => o.statusRaw).length > 300);
ok('保内保留外服/报修来源', () => wn.some(o => o.externalService === '乔童'));

console.log('\n[4. 重复编号与字段]');
const ids = all.map(o => o.id);
ok('id 全局唯一', () => new Set(ids).size === ids.length);
ok('重复编号带 -T 后缀', () => ids.filter(i => /-T\d+$/.test(i)).length === 9);
ok('结束态：有源日期则写完成日期，无源日期不编造', () => all.filter(o => ['已竣工', '已结清', '已关单', '维修完成'].includes(o.status)).every(o => !!o.completeDate === !!(o.registerDate || o.visitDate)));
ok('在修态写入开工日期', () => all.filter(o => o.status === '在修').every(o => !!o.startDate));
ok('已接单态不写开工日期(进池)', () => all.filter(o => o.status === '已接单').every(o => !o.startDate));

console.log('\n[5. 客户候选]');
const opts = require('./customer-options.js');
ok('候选 ≥ 150', () => opts.length >= 150);
ok('含「问界 昌平」', () => opts.indexOf('问界 昌平') >= 0);
ok('无空项', () => opts.every(x => x && x.length >= 2));

console.log('\n[6. 版本刷新逻辑（页面内联脚本）]');
const html = fs.readFileSync(path.join(base, 'index.html'), 'utf8');
ok('页面声明同版本常量', () => html.indexOf("const DATA_VERSION = '" + VER + "'") >= 0);
ok('loadData 检测版本不一致', () => /d\.dataVersion && d\.dataVersion !== DATA_VERSION/.test(html));
ok('initApp 拉取三本台账', () => /data_wn\.json/.test(html) && /data_nw\.json/.test(html) && /data_u\.json/.test(html));
ok('initApp 写入版本并整体替换', () => /APP\.dataVersion = DATA_VERSION/.test(html) && /APP\.unclassifiedOrders = uData/.test(html));
ok('提供手动重载按钮', () => html.indexOf('afReloadSeedData()') >= 0);
const rpt = fs.readFileSync(path.join(base, 'report-center.html'), 'utf8');
ok('报表页版本一致', () => rpt.indexOf("var DATA_VERSION = '" + VER + "'") >= 0);
ok('报表页版本过期自动重拉', () => /d\.dataVersion !== DATA_VERSION/.test(rpt) && /loadRemote\(\)/.test(rpt));

console.log('\n----------------------------------------');
console.log('PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
