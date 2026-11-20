// 新建工单统一入口 + 建单推送 + 钉钉@设置 页面测试：node assets/at-settings.test.cjs
const assert = require('assert');
const { loadPage } = require('./page-harness.cjs');

let pass = 0, fail = 0;
async function ok(name, fn) {
  try { await fn(); pass++; console.log('  PASS ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ' -> ' + e.message); }
}

function baseData() {
  return {
    warrantyOrders: [
      { id: 'WN-000001', registerDate: '2026-11-10', customerName: '北京奔驰', vehicleInfo: '京A00001', faultDesc: '检测', status: '未派工', engineer: '' }
    ],
    nonWarrantyOrders: [],
    unclassifiedOrders: [],
    engineers: ['刘珍', '罗永豪'], reporters: ['王鹏'], warehouseLogs: [],
    idCounters: { wn: 1, nw: 0, u: 0, wh: 0 }
  };
}

const HANDLES = {
  read: ['APP', 'ME', 'atDirCache', 'atNamesCache'],
  fns: ['renderAllOrders', 'openNewOrderChooser', 'openUnclassifiedForm', 'saveUnclassified',
    'openWarrantyForm', 'saveWarranty', 'openAtSettings', 'renderAtSettingsModal',
    'saveAtSettings', 'testAtNotice', 'pushDispatchNotice', 'retryDispatchNotice']
};

const tick = () => new Promise(r => setTimeout(r, 0));

(async () => {
  console.log('\n== 新建工单统一入口 ==');
  const H = loadPage('work-order/index.html', Object.assign({ storage: {
    station_mgmt_data: baseData(), af_identity: { name: '王鹏', role: 'DISPATCHER', at: '' }
  } }, HANDLES));
  assert.ok(!H.runError, H.runError && H.runError.message);

  await ok('总览只保留一个「新建工单」按钮', () => {
    const html = H.T.renderAllOrders();
    assert.ok(html.indexOf('新建工单') >= 0);
    assert.ok(html.indexOf('+ 新建保内</button>') < 0);
    assert.ok(html.indexOf('+ 新建保外</button>') < 0);
  });
  await ok('非管理员看不到钉钉@设置按钮', () => {
    assert.ok(H.T.renderAllOrders().indexOf('钉钉@设置') < 0);
  });
  await ok('统一入口提供三类工单选择', () => {
    H.T.openNewOrderChooser();
    const html = H.get('modalContent').innerHTML;
    ['新建工单 · 选择类型', '保内工单', '保外工单', '未分类工单', 'openUnclassifiedForm()'].forEach(s => {
      assert.ok(html.indexOf(s) >= 0, '缺少 ' + s);
    });
  });
  await ok('未分类工单可手工登记并落盘', () => {
    H.T.openUnclassifiedForm();
    H.setInput('f_u_vehicleInfo', '京D12345');
    H.setInput('f_u_faultDesc', '客户暂未说明IMEI');
    H.setInput('f_u_customerName', '临时客户');
    H.T.saveUnclassified('');
    const o = H.T.APP.unclassifiedOrders[0];
    assert.ok(o, '未写入未分类台账');
    assert.strictEqual(o.id, 'U-000001');
    assert.strictEqual(o.status, '待归类');
    assert.strictEqual(o.source, '手工新建');
    assert.ok(H.store.station_mgmt_data.indexOf('京D12345') >= 0, '未落盘');
  });
  await ok('只读岗位不能打开新建入口', () => {
    H.T.ME.role = 'AUDITOR';
    H.T.openNewOrderChooser();
    assert.ok(H.get('uploadStatusBar').innerHTML.indexOf('只读') >= 0);
    H.T.ME.role = 'DISPATCHER';
  });

  console.log('\n== 建单即派单推送 ==');
  await ok('保内建单指定工程师时自动推送提醒', async () => {
    const calls = [];
    H.ctx.DISPATCH_NOTIFY = {
      notify: (kind, order, engineer, operator, opts) => {
        calls.push({ kind, id: order.id, engineer, opts });
        return Promise.resolve({ ok: true, atMatched: true, msg: '提醒已送达' });
      }
    };
    H.T.openWarrantyForm();
    H.setInput('f_wn_customerName', '北京奔驰');
    H.setInput('f_wn_vehicleInfo', '京A99999');
    H.setInput('f_wn_faultDesc', '建单派单测试');
    H.setInput('f_wn_engineer', '刘珍');
    H.T.saveWarranty('');
    await tick();
    assert.strictEqual(calls.length, 1, '建单未推送');
    assert.strictEqual(calls[0].engineer, '刘珍');
    assert.strictEqual(calls[0].kind, '保内');
    assert.ok(H.get('uploadStatusBar').innerHTML.indexOf('已@') >= 0, '未显示@结果');
  });
  await ok('未指定工程师的建单不推送', async () => {
    const calls = [];
    H.ctx.DISPATCH_NOTIFY = { notify: (...a) => { calls.push(a); return Promise.resolve({ ok: true }); } };
    H.T.openWarrantyForm();
    H.setInput('f_wn_customerName', '北京奔驰');
    H.setInput('f_wn_vehicleInfo', '京B88888');
    H.setInput('f_wn_faultDesc', '待派单');
    H.setInput('f_wn_engineer', '');
    H.T.saveWarranty('');
    await tick();
    assert.strictEqual(calls.length, 0);
  });
  await ok('推送失败时提供手动重试入口', async () => {
    const calls = [];
    H.ctx.DISPATCH_NOTIFY = {
      notify: (kind, order, engineer, operator, opts) => {
        calls.push(opts && opts.force);
        return Promise.resolve({ ok: false, msg: 'offline' });
      }
    };
    const order = { id: 'WN-RETRY', customerName: '客户', vehicleInfo: '京A' };
    H.T.pushDispatchNotice('WN', order, '刘珍', '派单完成');
    await tick();
    const html = H.get('uploadStatusBar').innerHTML;
    assert.ok(html.indexOf('重试提醒') >= 0, '缺少重试按钮');
    H.T.retryDispatchNotice();
    await tick();
    assert.deepStrictEqual(calls, [false, true]);
  });

  console.log('\n== 管理员@名单设置 ==');
  const A = loadPage('work-order/index.html', Object.assign({ storage: {
    station_mgmt_data: baseData(), af_identity: { name: '赵轩', role: 'ADMIN', at: '' }
  } }, HANDLES));
  assert.ok(!A.runError, A.runError && A.runError.message);
  await ok('管理员可见钉钉@设置入口', () => {
    assert.ok(A.T.renderAllOrders().indexOf('钉钉@设置') >= 0);
  });
  await ok('打开设置时读取转发服务名单', async () => {
    let got = 0;
    A.ctx.DISPATCH_NOTIFY = {
      getAtDirectory: () => { got++; return Promise.resolve({ ok: true, directory: { '刘珍': { mobile: '13800138000' } } }); },
      saveAtDirectory: () => Promise.resolve({ ok: true, persisted: true }),
      notify: () => Promise.resolve({ ok: true })
    };
    A.T.openAtSettings();
    await tick(); await tick();
    assert.strictEqual(got, 1);
    assert.strictEqual(A.T.atDirCache['刘珍'].mobile, '13800138000');
    const html = A.get('modalContent').innerHTML;
    assert.ok(html.indexOf('钉钉群机器人') >= 0, '缺少@说明');
    assert.ok(html.indexOf('13800138000') >= 0, '未回填手机号');
  });
  await ok('保存名单时提交手机号与UserId', async () => {
    let saved = null;
    A.ctx.DISPATCH_NOTIFY.saveAtDirectory = (dir) => { saved = dir; return Promise.resolve({ ok: true, persisted: true }); };
    A.setInput('at_m_0', '13900139000');
    A.setInput('at_u_1', 'dingUser02');
    A.T.saveAtSettings();
    await tick();
    assert.ok(saved, '未调用保存');
    const vals = Object.values(saved);
    assert.ok(vals.some(v => v.mobile === '13900139000'));
    assert.ok(vals.some(v => v.userId === 'dingUser02'));
    assert.ok(A.store.nj_at_directory.indexOf('13900139000') >= 0, '未留本机备份');
  });
  await ok('测试@按钮发送一条带测试标记的提醒', async () => {
    let seen = null;
    A.ctx.DISPATCH_NOTIFY.notify = (kind, order, engineer) => { seen = { kind, order, engineer }; return Promise.resolve({ ok: true, atMatched: true }); };
    A.T.testAtNotice(0);
    await tick();
    assert.ok(seen, '未发送测试提醒');
    assert.ok(seen.order.id.indexOf('TEST-') === 0);
    assert.ok(seen.order.faultDesc.indexOf('测试') >= 0);
  });

  console.log('\n----------------------------------------');
  console.log('PASS ' + pass + ' / FAIL ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('FAIL -> ' + e.stack);
  process.exit(1);
});
