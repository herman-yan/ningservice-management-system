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
  assert.ok(names.length > 300, '候选过少: ' + names.length);
});
ok('无重复客户名', () => {
  assert.strictEqual(new Set(names).size, names.length);
});
ok('包含历史高频客户', () => {
  ['北京奔驰', '北汽越分', '理想来广营', '理想汽车北京来广营汽车城零售中心'].forEach(n => {
    assert.ok(names.indexOf(n) >= 0, '缺少 ' + n);
  });
});
ok('过滤空值与无意义名称', () => {
  ['', '无', '暂无', '未知', '-', '--'].forEach(n => assert.strictEqual(names.indexOf(n), -1));
  names.forEach(n => assert.ok(String(n).trim().length >= 2, '异常短名称: ' + n));
});
ok('按历史出现频次降序', () => {
  assert.strictEqual(names[0], '北京奔驰');
  assert.strictEqual(names[1], '北汽越分');
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

ok('新建保内工单的客户名为下拉点选', () => {
  T.openWarrantyForm();
  const html = els.get('modalContent').innerHTML;
  assert.ok(html.indexOf('<select class="form-select" id="f_wn_customerName"') >= 0);
  assert.ok(html.indexOf('f_wn_customerName" value=') < 0, '仍是可手填输入框');
  assert.ok(html.indexOf('北京奔驰') >= 0, '候选未进入下拉');
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
