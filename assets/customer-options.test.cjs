// 客户名称候选与建单表单单测：node assets/customer-options.test.cjs
const assert = require('assert');
const { loadPage } = require('./page-harness.cjs');
const names = require('./customer-options.js');

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ' -> ' + e.message); }
}

ok('候选名单非空且数量合理', () => {
  // 底账已于 2026-11-19 换为派工内控表（地点/客户列，209 个去重值）
  assert.ok(names.length > 180, '候选过少: ' + names.length);
});
ok('无重复客户名', () => {
  assert.strictEqual(new Set(names).size, names.length);
});
ok('包含内控表高频地点/客户', () => {
  ['来广营，理想', '理想 来广营', '站内'].forEach(n => {
    assert.ok(names.indexOf(n) >= 0, '缺少 ' + n);
  });
});
ok('过滤空值与无意义名称', () => {
  ['', '无', '暂无', '未知', '-', '--'].forEach(n => assert.strictEqual(names.indexOf(n), -1));
  names.forEach(n => assert.ok(String(n).trim().length >= 2, '异常短名称: ' + n));
});
ok('按内控表出现频次降序', () => {
  assert.strictEqual(names[0], '现代工厂');
  assert.strictEqual(names[1], '现代仓库');
});

const { els, T, get, runError } = loadPage('work-order/index.html', {
  storage: {
    station_mgmt_data: {
      warrantyOrders: [], nonWarrantyOrders: [], engineers: ['刘珍'], reporters: [],
      warehouseLogs: [], idCounters: { wn: 0, nw: 0, wh: 0 }
    },
    af_identity: { name: '王鹏', role: 'DISPATCHER', at: '' }
  },
  fns: ['customerOptionsHtml', 'openWarrantyForm', 'openNonWarrantyForm'],
  read: []
});
ok('页面在伪 DOM 中正常加载', () => assert.ok(!runError, runError && runError.message));

ok('新建保内工单客户名可输入并按历史名单模糊提示', () => {
  T.openWarrantyForm();
  const html = els.get('modalContent').innerHTML;
  assert.ok(html.indexOf('<input class="form-input" id="f_wn_customerName" list="wnCustomerList"') >= 0, '不是可输入客户框');
  assert.ok(html.indexOf('<datalist id="wnCustomerList">') >= 0, '缺少历史客户模糊提示');
  assert.ok(html.indexOf('来广营，理想') >= 0, '候选未进入模糊提示');
  assert.ok(html.indexOf('Barcode号（12位，选填）') >= 0, '车辆字段未改为选填Barcode号');
  assert.ok(html.indexOf('f_wn_gssOrderNo') < 0, 'GSS工单号仍在建单表单');
  assert.ok(html.indexOf('id="f_wn_platformNote"') >= 0, '新建表单缺少备注框');
});
ok('新建保外工单的签约客户为下拉点选', () => {
  T.openNonWarrantyForm();
  const html = els.get('modalContent').innerHTML;
  assert.ok(html.indexOf('<select class="form-select" id="f_nw_signedCustomer"') >= 0);
  assert.ok(html.indexOf('f_nw_signedCustomer" value=') < 0, '仍是可手填输入框');
});
ok('老单据不在候选里的客户名仍被保留', () => {
  const html = T.customerOptionsHtml('某个历史老客户');
  assert.ok(html.indexOf('某个历史老客户（历史记录）') >= 0);
  assert.ok(html.indexOf(' selected') >= 0);
});

console.log('\n----------------------------------------');
console.log('PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
