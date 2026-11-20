/*
 * 工单全流程走单测试（用页面真实脚本 + 伪 DOM 跑一遍真实操作序列）
 * 运行：node assets/full-flow-e2e.test.cjs
 *
 * 覆盖：管理员登录 → 建单 → 派单提醒 → 工程师备注 → 协同申请/审批 → 开始维修
 *       → 自检 → 质检驳回 → 重新自检 → 终检通过 → 报单 → 结清 → 终态与落盘核验
 */
const assert = require('assert');
const { loadPage } = require('./page-harness.cjs');

let pass = 0, fail = 0;
async function step(n, title, fn) {
  try {
    const detail = await fn();
    pass++;
    console.log(`[${String(n).padStart(2, '0')}] ✅ ${title}${detail ? ' → ' + detail : ''}`);
  } catch (e) {
    fail++;
    console.log(`[${String(n).padStart(2, '0')}] ❌ ${title} → ${e.message}`);
  }
}
function check(cond, msg) { if (!cond) throw new Error(msg); }
const tick = () => new Promise(r => setTimeout(r, 12));

const HANDLES = {
  read: ['APP', 'ME', 'currentPage', 'lastDispatchNotice'],
  write: ['ME', 'currentPage'],
  fns: [
    'openWarrantyForm', 'saveWarranty', 'afOpenAction', 'afConfirmAction', 'afCommit',
    'confirmDispatchWarranty', 'afOpenQcModal', 'afSubmitQc', 'afSubmitQc',
    'openEngineerNote', 'saveEngineerNote', 'openTransferRequest', 'submitTransferRequest',
    'afPendingTransfers', 'openTransferDecision', 'confirmTransferDecision',
    'settleWarranty', 'addSettleWorkerRow', 'removeSettleWorkerRow', 'confirmSettleWarranty',
    'afFindOrder', 'afWarranty', 'afNoteEntries', 'openAllNotes', 'renderAllNotesBody',
    'openOrderDetail', 'afUnassignedOrders', 'afAcceptedPending', 'renderAcceptedPending', 'renderUnassigned',
    'afActionButtons', 'renderAllOrders', 'renderAllRows', 'viewWarranty'
  ]
};

const seedData = {
  dataVersion: 'kz-20261119-v1',
  warrantyOrders: [], nonWarrantyOrders: [], unclassifiedOrders: [],
  engineers: ['刘珍', '罗永豪', '张峻'],
  reporters: ['王鹏'],
  warehouseLogs: [],
  idCounters: { wn: 0, nw: 0, u: 0, wh: 0 }
};

(async () => {
  console.log('===== 0. 登录门：管理员赵轩 / 000000 =====');
  const G = loadPage('work-order/index.html', {
    withAuth: true,
    storage: { station_mgmt_data: seedData },
    read: ['ME'], fns: ['afCanEnter']
  });
  assert.ok(!G.runError, G.runError && G.runError.message);
  G.loginAs('赵轩', '000000');
  check(G.isLocked() === false, '登录后页面仍锁定');
  check(G.T.ME.role === 'ADMIN', '赵轩未取得管理员角色：' + G.T.ME.role);
  check(G.T.afCanEnter('allorders') === true, '管理员不能进入工单总览');
  console.log('[00] ✅ 赵轩用 000000 登录成功，身份=管理员，可进工单总览');

  // 主流程用一个干净会话，逐岗位切换身份（等价于不同人登录各自账号后操作）
  const notifyCalls = [];
  const fetchMock = async (url, init) => {
    if (/data_(wn|nw|u)\.json/.test(String(url))) {
      return { ok: false, status: 404, json: async () => null };
    }
    notifyCalls.push({
      url: String(url),
      method: (init && init.method) || 'GET',
      body: init && init.body ? JSON.parse(init.body) : null
    });
    return { ok: true, status: 200, json: async () => ({ ok: true, atMatched: true, msg: 'ok' }) };
  };
  const H = loadPage('work-order/index.html', Object.assign({
    fetch: fetchMock,
    storage: Object.assign({ station_mgmt_data: seedData },
      { af_identity: JSON.stringify({ name: '赵轩', role: 'ADMIN', at: '' }) })
  }, HANDLES));
  assert.ok(!H.runError, H.runError && H.runError.message);
  const T = H.T;
  const setRole = (name, role) => { T.ME = { name, role }; };
  const set = (id, v) => H.setInput(id, v);
  const posted = () => notifyCalls.filter(c => c.method === 'POST' && /\/notify/.test(c.url));
  const order = () => T.afFindOrder('WN', 'WN-000001');
  const status = () => order().status;

  console.log('\n===== A. 建单 → 派单 =====');
  await step(1, '管理员建保内单（客户/Barcode/故障/备注）', () => {
    setRole('赵轩', 'ADMIN');
    T.openWarrantyForm();
    set('f_wn_registerDate', '2026-11-20');
    set('f_wn_customerName', '全流程测试客户');
    set('f_wn_vehicleInfo', '123456789012');
    set('f_wn_faultDesc', '电池包绝缘阻值偏低，需拆检');
    set('f_wn_platformNote', '客户要求今日反馈，先做绝缘测试');
    set('f_wn_engineer', '');
    T.saveWarranty('');
    check(!!order(), '工单未创建');
    check(status() === '未派工', '新单状态应为未派工，实际 ' + status());
    check(order().platformNote === '客户要求今日反馈，先做绝缘测试', '建单备注未保存');
    check(T.afUnassignedOrders().some(x => x.o.id === 'WN-000001'), '未进入未派工待办');
    return `WN-000001 / ${status()} / 备注已落盘`;
  });

  await step(2, '未派工卡片展示中台备注', () => {
    const html = T.renderUnassigned(T.afUnassignedOrders());
    check(html.indexOf('中台备注：客户要求今日反馈，先做绝缘测试') >= 0, '卡片未显示备注');
    return '备注可见';
  });

  await step(3, '调度派单给刘珍并补充中台备注', async () => {
    setRole('王鹏', 'DISPATCHER');
    T.afOpenAction('WN', 'WN-000001', 'dispatch');
    set('dispatch_eng', '刘珍');
    set('dispatch_platformNote', '优先测绝缘，备好高压防护用品');
    T.confirmDispatchWarranty('WN-000001');
    check(status() === '已接单', '派单后应为已接单，实际 ' + status());
    check(order().engineer === '刘珍', '责任工程师未写入');
    check(order().platformNote === '优先测绝缘，备好高压防护用品', '派单备注未覆盖');
    check(T.afAcceptedPending().some(x => x.o.id === 'WN-000001'), '未进入已接单未进行待办');
    return `${status()} / 工程师=刘珍`;
  });
  await tick();

  await step(4, '钉钉提醒已发到转发服务且写明工程师', () => {
    const p = posted();
    check(p.length >= 1, '没有捕获到通知请求');
    const body = p[p.length - 1].body;
    check(body.engineer === '刘珍', '通知未写明工程师：' + JSON.stringify(body));
    check(body.id === 'WN-000001', '通知工单号不对');
    check(body.operator === '王鹏', '通知操作人不对：' + body.operator);
    const bar = H.get('uploadStatusBar').innerHTML || '';
    check(bar.indexOf('钉钉提醒已推送给 刘珍') >= 0, '状态栏未显示推送结果：' + bar);
    return `已推送 / @匹配=${bar.indexOf('（已@）') >= 0}`;
  });

  console.log('\n===== B. 工程师备注与双工程师协同 =====');
  await step(5, '技师刘珍可开始维修、备注、申请协同', () => {
    setRole('刘珍', 'TECHNICIAN');
    const btns = T.afActionButtons('WN', order());
    check(btns.indexOf('开始维修') >= 0, '缺少开始维修按钮');
    check(btns.indexOf('工程师备注') >= 0, '缺少工程师备注按钮');
    check(btns.indexOf('申请协同') >= 0, '缺少申请协同按钮');
    T.openEngineerNote('WN', 'WN-000001');
    set('eng_note_text', '电池包已拆检，等待BMS备件；剩余均衡工序未完成');
    T.saveEngineerNote('WN', 'WN-000001');
    check(order().engineerProgressNote.indexOf('等待BMS备件') >= 0, '工程师备注未保存');
    check(T.afWarranty().some(x => x.id === 'WN-000001'), '主修工程师看不到自己的单');
    return '备注已保存且技师可见本单';
  });

  await step(6, '刘珍发起协同申请（罗永豪接手）', () => {
    T.openTransferRequest('WN', 'WN-000001');
    set('tr_to', '罗永豪');
    set('tr_reason', '本人需支援其他站点，剩余均衡工序请罗永豪接手');
    T.submitTransferRequest('WN', 'WN-000001');
    const reqs = T.afPendingTransfers();
    check(reqs.length === 1, '协同申请未生成');
    check(reqs[0].req.to === '罗永豪' && reqs[0].req.status === '待审批', '申请内容不对');
    return '待审批 1 条';
  });

  await step(7, '管理员批准协同，两人共同负责', async () => {
    setRole('赵轩', 'ADMIN');
    const req = T.afPendingTransfers()[0].req;
    T.openTransferDecision('WN', 'WN-000001', req.id, true);
    T.confirmTransferDecision('WN', 'WN-000001', req.id, true);
    check(JSON.stringify(order().coEngineers) === '["罗永豪"]', '协同工程师未加入：' + JSON.stringify(order().coEngineers));
    check(req.status === '已批准' && req.decidedBy === '赵轩', '审批未留痕');
    setRole('罗永豪', 'TECHNICIAN');
    check(T.afWarranty().some(x => x.id === 'WN-000001'), '协同工程师看不到本单');
    return '主修=刘珍 + 协同=罗永豪，双方可见';
  });
  await tick();

  await step(8, '协同审批也推送钉钉给罗永豪', () => {
    const p = posted();
    check(p.length >= 2, '协同审批未发提醒');
    check(p[p.length - 1].body.engineer === '罗永豪', '提醒对象不对');
    return '提醒对象=罗永豪';
  });

  console.log('\n===== C. 维修 → 自检 → 质检 → 报单 → 结清 =====');
  await step(9, '开始维修 → 在修', () => {
    setRole('罗永豪', 'TECHNICIAN');
    T.afCommit('WN', 'WN-000001', 'start', {});
    check(status() === '在修', '状态应为在修，实际 ' + status());
    check(!!order().startDate, '未记录开工日期');
    return `${status()} / 开工日期=${order().startDate}`;
  });

  await step(10, '自检 11 项 + 3 项数值门槛通过 → 待质检终检', () => {
    setRole('罗永豪', 'TECHNICIAN');
    T.afOpenQcModal('WN', 'WN-000001');
    const codes = ['power_ppe', 'tools_fod_clear', 'repair_per_sop', 'material_assembly_match',
      'torque_marks', 'insulation_pass', 'enclosure_sealing_pass', 'cooling_sealing_pass',
      'diagnostics_clear', 'appearance_labels', 'records_parts_complete'];
    codes.forEach(c => { H.get('qc_' + c).checked = true; });
    set('qc_insulationMohm', '120');
    set('qc_capacityRecoveryPct', '98');
    set('qc_voltageDrop72hMv', '12');
    set('comp_date', '2026-11-20');
    set('comp_note', '绝缘恢复，容量98%，完成均衡');
    T.afSubmitQc('WN', 'WN-000001');
    check(status() === '待质检终检', '自检后状态不对：' + status());
    check(order().qc.self.name === '罗永豪', '自检留痕人不对');
    check(!T.afActionButtons('WN', order()).includes('终检通过'), '技师不应能终检');
    return `${status()} / 自检人=罗永豪 / 责任分离生效`;
  });

  await step(11, '质检员驳回 → 驳回待重检，技师重新自检', () => {
    setRole('张峻', 'QUALITY_INSPECTOR');
    T.afOpenAction('WN', 'WN-000001', 'reject');
    T.afConfirmAction('WN', 'WN-000001', 'reject');
    check(status() === '驳回待重检', '驳回后状态不对：' + status());
    setRole('罗永豪', 'TECHNICIAN');
    T.afOpenQcModal('WN', 'WN-000001');
    ['power_ppe', 'tools_fod_clear', 'repair_per_sop', 'material_assembly_match',
      'torque_marks', 'insulation_pass', 'enclosure_sealing_pass', 'cooling_sealing_pass',
      'diagnostics_clear', 'appearance_labels', 'records_parts_complete']
      .forEach(c => { H.get('qc_' + c).checked = true; });
    set('qc_insulationMohm', '150');
    set('qc_capacityRecoveryPct', '99');
    set('qc_voltageDrop72hMv', '8');
    T.afSubmitQc('WN', 'WN-000001');
    check(status() === '待质检终检', '重新自检后状态不对：' + status());
    return '驳回 → 重检 → 待质检终检';
  });

  await step(12, '质检员终检通过 → 已竣工', () => {
    setRole('张峻', 'QUALITY_INSPECTOR');
    T.afOpenAction('WN', 'WN-000001', 'final_pass');
    T.afConfirmAction('WN', 'WN-000001', 'final_pass');
    check(status() === '已竣工', '终检后状态不对：' + status());
    check(order().qc.final.name === '张峻', '终检留痕人不对');
    return `${status()} / 终检人=张峻（与自检异人）`;
  });

  await step(13, '报单员报单：默认一组，点+追加第二名工程师 → 已报单', () => {
    setRole('王鹏', 'REPORTER');
    T.afOpenAction('WN', 'WN-000001', 'settle');
    let html = H.get('modalContent').innerHTML;
    check(html.indexOf('参与维修工程师 1') >= 0 && html.indexOf('settle_hours_0') >= 0, '默认组缺工时字段');
    check(html.indexOf('settle_worker_1') < 0, '默认不应出现第二组');
    check(html.indexOf('addSettleWorkerRow') >= 0, '缺少+追加按钮');
    set('settle_reporter', '王鹏');
    set('settle_gssOrderNo', 'GSS-20261120-001');
    set('settle_gssFee', '3200');
    set('settle_worker_0', '刘珍'); set('settle_hours_0', '3.5'); set('settle_mileage_0', '12');
    T.addSettleWorkerRow('WN-000001');
    html = H.get('modalContent').innerHTML;
    check(html.indexOf('settle_worker_1') >= 0, '点+后未追加第二组');
    check(html.indexOf('removeSettleWorkerRow') >= 0, '追加组缺删除入口');
    set('settle_worker_1', '罗永豪'); set('settle_hours_1', '2.5'); set('settle_mileage_1', '8');
    T.confirmSettleWarranty('WN-000001');
    check(status() === '已报单', '报单后状态不对：' + status());
    check(order().settleWorkers.length === 2, '参与维修工程师未保存两人');
    check(order().settleWorkers[1].hours === '2.5' && order().settleWorkers[1].mileage === '8', '工时/里程未保存');
    check(order().gssOrderNo === 'GSS-20261120-001', 'GSS工单号未保存');
    return `${status()} / 默认1组→追加至2组并保存`;
  });

  await step(14, '财务结清 → 已结清（终态）', () => {
    setRole('赵财', 'FINANCE');
    T.afOpenAction('WN', 'WN-000001', 'clear');
    T.afConfirmAction('WN', 'WN-000001', 'clear');
    check(status() === '已结清', '结清后状态不对：' + status());
    check(!!order().clearedDate, '未记录结清日期');
    const btns = T.afActionButtons('WN', order());
    check(btns.indexOf('afOpenAction') < 0, '终态仍有流转按钮：' + btns);
    check(!T.afUnassignedOrders().some(x => x.o.id === 'WN-000001'), '终态仍占用待派位');
    return `${status()} / 无流转按钮 / 已退出待办`;
  });

  console.log('\n===== D. 落盘与留痕核验 =====');
  await step(15, 'localStorage 落盘完整审计链', () => {
    const saved = JSON.parse(H.store.station_mgmt_data);
    const o = saved.warrantyOrders.find(x => x.id === 'WN-000001');
    check(!!o, '未落盘');
    check(o.status === '已结清', '落盘状态不对：' + o.status);
    const actions = (o.audit || []).map(a => a.action);
    ['dispatch', 'engineer_note', 'transfer_request', 'transfer_approve', 'start',
      'self_check', 'reject', 'self_check', 'final_pass', 'settle', 'clear']
      .forEach(a => check(actions.indexOf(a) >= 0, '审计链缺 ' + a + '：' + actions.join(',')));
    check(o.platformNote === '优先测绝缘，备好高压防护用品', '派单备注未落盘');
    check(o.engineerProgressNote.indexOf('等待BMS备件') >= 0, '工程师备注未落盘');
    return `${actions.length} 条留痕：${actions.join(' → ')}`;
  });

  await step(16, '详情展示双工程师、全部备注明细、报单分工', () => {
    setRole('赵轩', 'ADMIN');
    T.viewWarranty('WN-000001');
    const html = H.get('modalContent').innerHTML || '';
    ['刘珍', '罗永豪', '参与维修', '备注明细（全部）', '中台备注', '工程师进度备注',
      '等待BMS备件', 'GSS-20261120-001']
      .forEach(k => check(html.indexOf(k) >= 0, '详情缺 ' + k));
    const notes = T.afNoteEntries('WN', order());
    check(notes.length >= 8, '备注条目过少：' + notes.length);
    check(notes.some(n => n.source === '工程师进度备注' && n.who === '刘珍'), '工程师备注未归集到本人');
    return `${notes.length} 条备注集中展示`;
  });

  await step(17, '点击总览工单编号可打开详情', () => {
    const rows = T.renderAllRows([{ o: order(), kind: 'WN', cat: '保内' }]);
    check(rows.indexOf("openOrderDetail('WN','WN-000001')") >= 0, '编号列未做成可点击');
    T.openOrderDetail('WN', 'WN-000001');
    check((H.get('modalContent').innerHTML || '').indexOf('备注明细（全部）') >= 0, '点编号后未打开详情');
    return '编号可点开详情';
  });

  await step(18, '管理员「全部备注」一览所有人备注并可筛选', () => {
    setRole('赵轩', 'ADMIN');
    const page = T.renderAllOrders();
    check(page.indexOf('openAllNotes()') >= 0, '总览缺管理员备注入口');
    setRole('刘珍', 'TECHNICIAN');
    check(T.renderAllOrders().indexOf('openAllNotes()') < 0, '非管理员不应看到入口');
    setRole('赵轩', 'ADMIN');
    T.openAllNotes();
    check((H.get('modalContent').innerHTML || '').indexOf('全部工单备注') >= 0, '未打开备注总览');
    const body = H.get('allNotesBody').innerHTML || '';
    check(body.indexOf('WN-000001') >= 0 && body.indexOf('等待BMS备件') >= 0, '备注表未列出工程师备注');
    check(body.indexOf('优先测绝缘') >= 0, '备注表未列出中台备注');
    set('allNotesSearch', '罗永豪');
    T.renderAllNotesBody();
    check(H.get('allNotesBody').innerHTML.indexOf('WN-000001') >= 0, '按人筛选失效');
    set('allNotesSearch', '一个不存在的关键词');
    T.renderAllNotesBody();
    check(H.get('allNotesBody').innerHTML.indexOf('没有匹配的备注') >= 0, '空结果提示缺失');
    return '全员备注可查、可按人/内容筛选';
  });

  console.log('\n----------------------------------------');
  console.log(`全流程走单 PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('运行异常：', e); process.exit(1); });
