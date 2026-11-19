/*
 * 派单提醒页面级集成测试：node assets/dispatch-notify.integration.test.cjs
 * 在页面夹具里执行真实派单，经真实转发服务发送钉钉，并核对发送记录。
 * 需要网络可达转发服务；发送的是一条标记清晰的联调工单。
 */
const assert = require('assert');
const { loadPage } = require('./page-harness.cjs');

const ID = 'WN-INT-' + Date.now();
const ENGINEER = '刘珍';
const RECENT_URL = 'https://nj-dispatch-relay.app.workbuddy.host/recent?sharecode=6OF6AIIPFN&key=njRelay_2026_9d4f7a1c6b8e2d50';

const seedData = {
  warrantyOrders: [{
    id: ID, registerDate: '2026-11-19', customerName: '派单提醒集成测试客户',
    vehicleInfo: '京A-INT01', faultDesc: '派单提醒链路联调（测试单）',
    status: '未派工', engineer: '', reporter: ''
  }],
  nonWarrantyOrders: [],
  engineers: [ENGINEER, '罗永豪'],
  reporters: ['王鹏'],
  warehouseLogs: [],
  idCounters: { wn: 1, nw: 0, wh: 0 }
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const { T, get, runError } = loadPage('work-order/index.html', {
    storage: {
      station_mgmt_data: seedData,
      af_identity: { name: '王鹏', role: 'DISPATCHER', at: '' }
    },
    read: ['APP', 'ME', 'DISPATCH_NOTIFY'],
    fns: ['afCommit'],
    fetch: globalThis.fetch
  });
  assert.ok(!runError, '页面脚本运行失败: ' + (runError && runError.message));
  assert.ok(T.ME && T.ME.name === '王鹏', '调度身份未就位');
  assert.ok(T.DISPATCH_NOTIFY, '派单提醒模块未加载');

  T.afCommit('WN', ID, 'dispatch', { engineer: ENGINEER });
  const order = T.APP.warrantyOrders.find(o => o.id === ID);
  assert.strictEqual(order.status, '未开工', '派单未改变工单状态');
  assert.strictEqual(order.engineer, ENGINEER, '责任工程师未写入');

  let text = '';
  for (let i = 0; i < 30; i++) {
    text = String(get('uploadStatusBar').innerHTML || '');
    if (text.indexOf('已推送给') >= 0 || text.indexOf('未送达') >= 0) break;
    await sleep(500);
  }
  assert.ok(text.indexOf('钉钉提醒已推送给 ' + ENGINEER) >= 0,
    '状态栏未显示送达结果，实际为: ' + text);

  const resp = await fetch(RECENT_URL, { cache: 'no-store' });
  assert.strictEqual(resp.status, 200, '无法读取转发记录 HTTP ' + resp.status);
  const data = await resp.json();
  const rec = (data.items || []).find(x => x.id === ID && x.engineer === ENGINEER);
  assert.ok(rec, '转发服务未记录本次派单');
  assert.strictEqual(rec.ok, true, '钉钉返回失败: ' + rec.errmsg);
  assert.ok(rec.text.indexOf(ENGINEER) >= 0, '提醒正文缺少工程师姓名');
  assert.ok(rec.text.indexOf('派单提醒实测客户') >= 0 || rec.text.indexOf(ID) >= 0, '提醒正文缺少工单信息');

  console.log('\n----------------------------------------');
  console.log('PASS 派单页面集成：状态流转 + 钉钉送达 + 服务端记录');
  console.log('工单 ' + ID + ' -> ' + ENGINEER + '：' + text);
  process.exit(0);
})().catch(e => {
  console.error('\nFAIL 派单页面集成 -> ' + e.message);
  process.exit(1);
});
