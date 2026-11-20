// 本轮界面改造单测：node assets/ui-flow-2.test.cjs
const assert = require('assert');
const { loadPage } = require('./page-harness.cjs');

let pass = 0, fail = 0;
async function ok(name, fn) {
  try { await fn(); pass++; console.log('  PASS ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ' -> ' + e.message); }
}

function seed(role, name) {
  return {
    station_mgmt_data: {
      warrantyOrders: [
        { id: 'WN-U001', registerDate: '2026-11-20', customerName: '测试客户', barcode: '123456789012',
          vehicleInfo: '123456789012', faultDesc: '检修', status: '未派工', engineer: '', platformNote: '' },
        { id: 'WN-U002', registerDate: '2026-11-20', customerName: '测试客户2', barcode: '123456789013',
          vehicleInfo: '123456789013', faultDesc: '在修工单', status: '在修', engineer: '刘珍',
          platformNote: '中台交代：先做绝缘测试' },
        { id: 'WN-U003', registerDate: '2026-11-20', customerName: '测试客户3', barcode: '123456789014',
          vehicleInfo: '123456789014', faultDesc: '待终检', status: '待质检终检', engineer: '刘珍',
          qc: { self: { name: '罗永豪', qc: {} } } }
      ],
      nonWarrantyOrders: [], unclassifiedOrders: [],
      engineers: ['刘珍', '罗永豪', '张峻'], reporters: ['王鹏'], warehouseLogs: [],
      idCounters: { wn: 3, nw: 0, u: 0, wh: 0 }
    },
    af_identity: { name: name || '刘珍', role: role, at: '' }
  };
}

const HANDLES = {
  read: ['APP', 'ME'],
  fns: ['renderAllOrders', 'renderAcceptedPending', 'afUnassignedOrders', 'afAllOrders',
    'afActionButtons', 'openEngineerNote', 'saveEngineerNote', 'afOpenQcModal',
    'openTransferRequest', 'submitTransferRequest', 'afPendingTransfers',
    'openTransferDecision', 'confirmTransferDecision', 'afFindOrder', 'settleWarranty',
    'afWarranty', 'renderAllRows', 'viewWarranty']
};

(async () => {
  console.log('\n== 待跟进区 ==');
  const D = loadPage('work-order/index.html', Object.assign({ storage: seed('DISPATCHER', '王鹏') }, HANDLES));
  assert.ok(!D.runError, D.runError && D.runError.message);
  D.ctx.DISPATCH_NOTIFY = { notify: () => Promise.resolve({ ok: true }), sendDigest: () => Promise.resolve({ ok: true }) };

  await ok('工程师为空的工单单独露出', () => {
    const list = D.T.afUnassignedOrders();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].o.id, 'WN-U001');
    const html = D.T.renderAllOrders();
    assert.ok(html.indexOf('未派工（工程师为空）') >= 0);
    assert.ok(html.indexOf('WN-U001') >= 0);
  });
  await ok('待跟进卡片展示中台备注', () => {
    const html = D.T.renderAcceptedPending(D.T.afAllOrders().filter(x => x.o.id === 'WN-U002'));
    assert.ok(html.indexOf('中台备注：中台交代：先做绝缘测试') >= 0);
  });

  console.log('\n== 在修与自检 ==');
  const T = loadPage('work-order/index.html', Object.assign({ storage: seed('TECHNICIAN', '刘珍') }, HANDLES));
  assert.ok(!T.runError, T.runError && T.runError.message);
  T.ctx.DISPATCH_NOTIFY = { notify: () => Promise.resolve({ ok: true }) };

  await ok('在修状态新增工程师备注与申请协同按钮', () => {
    const html = T.T.afActionButtons('WN', T.T.afFindOrder('WN', 'WN-U002'));
    assert.ok(html.indexOf('工程师备注') >= 0);
    assert.ok(html.indexOf('申请协同') >= 0);
  });
  await ok('工程师备注可保存并留痕', () => {
    T.T.openEngineerNote('WN', 'WN-U002');
    T.setInput('eng_note_text', '剩余均衡工序未完成');
    T.T.saveEngineerNote('WN', 'WN-U002');
    const o = T.T.afFindOrder('WN', 'WN-U002');
    assert.strictEqual(o.engineerProgressNote, '剩余均衡工序未完成');
    assert.ok(o.audit.some(a => a.action === 'engineer_note'));
  });
  await ok('自检弹窗不再出现工程师产值', () => {
    T.T.afOpenQcModal('WN', 'WN-U002');
    const html = T.get('modalContent').innerHTML;
    assert.ok(html.indexOf('comp_output') < 0);
    assert.ok(html.indexOf('工程师产值') < 0);
  });

  console.log('\n== 终检通过 ==');
  const A = loadPage('work-order/index.html', Object.assign({ storage: seed('ADMIN', '赵轩') }, HANDLES));
  assert.ok(!A.runError, A.runError && A.runError.message);
  A.ctx.DISPATCH_NOTIFY = { notify: () => Promise.resolve({ ok: true }) };
  await ok('管理员在待质检终检状态可见通过按钮', () => {
    const html = A.T.afActionButtons('WN', A.T.afFindOrder('WN', 'WN-U003'));
    assert.ok(html.indexOf('终检通过') >= 0, '缺少通过按钮：' + html);
    assert.ok(html.indexOf('技术否决') >= 0);
  });

  console.log('\n== 双工程师协同 ==');
  await ok('工程师提交协同申请（接手人+原因必填）', () => {
    T.T.openTransferRequest('WN', 'WN-U002');
    T.setInput('tr_to', '罗永豪');
    T.setInput('tr_reason', '本人需支援其他站点');
    T.T.submitTransferRequest('WN', 'WN-U002');
    const reqs = T.T.afPendingTransfers();
    assert.strictEqual(reqs.length, 1);
    assert.strictEqual(reqs[0].o.id, 'WN-U002');
    assert.strictEqual(reqs[0].req.to, '罗永豪');
    assert.strictEqual(T.T.afFindOrder('WN', 'WN-U002').transferRequests[0].status, '待审批');
  });
  await ok('同页审批：批准后两人共同展示', async () => {
    T.T.ME.role = 'ADMIN';
    T.T.ME.name = '赵轩';
    const reqId = T.T.afPendingTransfers()[0].req.id;
    T.T.openTransferDecision('WN', 'WN-U002', reqId, true);
    T.setInput('tr_decision_note', '同意');
    T.T.confirmTransferDecision('WN', 'WN-U002', reqId, true);
    await Promise.resolve();
    const o = T.T.afFindOrder('WN', 'WN-U002');
    assert.strictEqual(o.engineer, '刘珍', '主修被改动');
    assert.strictEqual(JSON.stringify(o.coEngineers), '["罗永豪"]');
    assert.strictEqual(o.transferRequests[0].status, '已批准');
    const html = T.T.renderAllRows([{ o: o, kind: 'WN', cat: '保内' }]);
    assert.ok(html.indexOf('刘珍 + 罗永豪') >= 0, '列表未展示两位工程师');
    assert.ok(o.audit.some(a => a.action === 'transfer_approve'));
  });
  await ok('协同工程师本人可见该工单', () => {
    T.T.ME.role = 'TECHNICIAN';
    T.T.ME.name = '罗永豪';
    assert.ok(T.T.afWarranty().some(o => o.id === 'WN-U002'), '协同工程师看不到工单');
  });
  await ok('驳回协同申请不加入工程师', () => {
    T.T.ME.role = 'TECHNICIAN';
    T.T.ME.name = '刘珍';
    T.T.openTransferRequest('WN', 'WN-U002');
    T.setInput('tr_to', '张峻');
    T.setInput('tr_reason', '第二人申请');
    T.T.submitTransferRequest('WN', 'WN-U002');
    T.T.ME.role = 'ADMIN';
    const reqId = T.T.afPendingTransfers()[0].req.id;
    T.T.openTransferDecision('WN', 'WN-U002', reqId, false);
    T.setInput('tr_decision_note', '人手不足');
    T.T.confirmTransferDecision('WN', 'WN-U002', reqId, false);
    const o = T.T.afFindOrder('WN', 'WN-U002');
    assert.strictEqual(JSON.stringify(o.coEngineers), '["罗永豪"]');
    assert.strictEqual(o.transferRequests[0].status, '已驳回');
  });

  console.log('\n== 结算步骤 ==');
  await ok('GSS工单号改在结算步骤录入', () => {
    A.T.settleWarranty('WN-U003');
    const html = A.get('modalContent').innerHTML;
    assert.ok(html.indexOf('settle_gssOrderNo') >= 0);
    assert.ok(html.indexOf('settle_reporter') >= 0);
  });

  console.log('\n----------------------------------------');
  console.log('PASS ' + pass + ' / FAIL ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('FAIL -> ' + e.stack);
  process.exit(1);
});
