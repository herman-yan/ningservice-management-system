// 统一工单总览 / 未分类 / 已接单未进行 单测：node assets/all-orders.test.cjs
const assert = require('assert');
const { loadPage } = require('./page-harness.cjs');

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ' -> ' + e.message); }
}

const seed = {
  station_mgmt_data: {
    warrantyOrders: [
      { id: 'WN-000001', registerDate: '2026-11-10', customerName: '北京奔驰', vehicleInfo: '京A00001', faultDesc: '检测', status: '已接单', engineer: '刘珍', audit: [{ action: 'dispatch', at: '2026-11-10T09:00:00Z' }] },
      { id: 'WN-000002', registerDate: '2026-11-11', customerName: '北汽越分', vehicleInfo: '京A00002', faultDesc: '检修', status: '在修', engineer: '罗永豪' }
    ],
    nonWarrantyOrders: [
      { id: 'NW-000001', requestDate: '2026-11-12', signedCustomer: '理想来广营', plateNumber: '京B00001', faultDesc: '电池包', status: '报价确认', repairEngineer: '' }
    ],
    unclassifiedOrders: [
      { id: 'U-000001', customerName: '来源不明客户', vehicleInfo: '京C00001', faultDesc: '未识别行', status: '待归类', statusRaw: '未知状态' }
    ],
    engineers: ['刘珍', '罗永豪'], reporters: ['王鹏'], warehouseLogs: [],
    idCounters: { wn: 2, nw: 1, u: 1, wh: 0 }
  },
  af_identity: { name: '王鹏', role: 'DISPATCHER', at: '' }
};
const HANDLES = {
  read: ['APP', 'ME', 'currentPage'],
  fns: ['renderAllOrders', 'afAllOrders', 'afAcceptedPending', 'afWaitDays', 'afUnclassified',
    'classifyUnclassified', 'classifySheetRows', 'afCommitImport', 'filterAllCategory',
    'applyAllFilter', 'customerOptionsHtml']
};

const { els, T, store, runError } = loadPage('work-order/index.html', Object.assign({ storage: seed }, HANDLES));
ok('页面在统一总览为默认页且无运行错误', () => {
  assert.ok(!runError, runError && runError.message);
  assert.strictEqual(T.currentPage, 'allorders');
});

ok('统一视图合并三类工单', () => {
  const all = T.afAllOrders();
  assert.strictEqual(all.length, 4);
  assert.strictEqual(JSON.stringify(all.map(x => x.cat).sort()), JSON.stringify(['保内', '保内', '保外', '未分类'].sort()));
});
ok('总览页面呈现分类标签与三类单据', () => {
  const html = T.renderAllOrders();
  ['工单总览', '保内', '保外', '未分类', 'WN-000001', 'NW-000001', 'U-000001'].forEach(s => {
    assert.ok(html.indexOf(s) >= 0, '缺少 ' + s);
  });
});
ok('已接单未进行池子只收未开工的已接单单', () => {
  const p = T.afAcceptedPending();
  assert.strictEqual(p.length, 1);
  assert.strictEqual(p[0].o.id, 'WN-000001');
  assert.ok(p[0].days >= 0);
});
ok('已开工的单不再进入待跟进池', () => {
  const o = T.APP.warrantyOrders.find(x => x.id === 'WN-000001');
  o.startDate = '2026-11-12';
  assert.strictEqual(T.afAcceptedPending().length, 0);
  delete o.startDate;
});
ok('分类筛选生效', () => {
  T.filterAllCategory('未分类');
  const body = els.get('allTableBody').innerHTML;
  assert.ok(body.indexOf('U-000001') >= 0);
  assert.ok(body.indexOf('WN-000001') < 0);
  T.filterAllCategory('全部');
});
ok('导入无法判定的行进入未分类', () => {
  const mixed = [
    { '客户名称': '神秘客户', '车辆信息': '京D00001', '故障描述': '描述不清' },
    { '编号': 'NJ-000001', '责任工程师': '刘珍', '登记日期': '2026-11-01' }
  ];
  const r1 = T.classifySheetRows(mixed);
  assert.strictEqual(r1.wn.length + r1.nw.length + r1.other.length, 2, '每行都要有归属');
  const unknown = T.classifySheetRows([{ '自定义列': '无法判定' }]);
  assert.strictEqual(unknown.other.length, 1, '完全无特征的行应进未分类');
});
ok('未分类行可人工归入保内并保留原始线索', () => {
  T.classifyUnclassified('U-000001', 'WN');
  assert.strictEqual(T.afUnclassified().length, 0);
  const moved = T.APP.warrantyOrders.find(o => o.customerName === '来源不明客户');
  assert.ok(moved, '未进入保内台账');
  assert.strictEqual(moved.status, '未派工');
  assert.strictEqual(moved.statusRaw, '未知状态');
  assert.ok(moved.audit.some(a => a.action === 'classify'));
  assert.ok(store.station_mgmt_data.indexOf('来源不明客户') >= 0, '未落盘');
});
ok('归类为保外时进入保外台账并使用保外入口状态', () => {
  T.APP.unclassifiedOrders = [{ id: 'U-000002', signedCustomer: '某签约客户', plateNumber: '京E00001', status: '待归类' }];
  T.classifyUnclassified('U-000002', 'NW');
  const moved = T.APP.nonWarrantyOrders.find(o => o.id === 'U-000002' || o.signedCustomer === '某签约客户');
  assert.ok(moved, '未进入保外台账');
  assert.strictEqual(moved.status, '待客户确认');
});
ok('导入结果含未分类统计', () => {
  const r = T.afCommitImport({
    totalWn: 0, totalNw: 0, totalOther: 1, skipped: 0,
    newWnData: [], newNwData: [],
    newOtherData: [{ id: 'U-000003', customerName: '新未分类客户', status: '待归类', category: '未分类' }]
  });
  assert.strictEqual(r.other.added, 1);
  assert.ok(T.afUnclassified().some(o => o.id === 'U-000003'));
});

console.log('\n----------------------------------------');
console.log('PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
