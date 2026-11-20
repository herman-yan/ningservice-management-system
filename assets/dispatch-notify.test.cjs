// 派单钉钉提醒模块单测：node assets/dispatch-notify.test.cjs
const assert = require('assert');
const N = require('./dispatch-notify.js');

let pass = 0, fail = 0;
async function ok(name, fn) {
  try { await fn(); pass++; console.log('  PASS ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ' -> ' + e.message); }
}
function fakeFetch(result) {
  const calls = [];
  const fn = function (url, opts) {
    calls.push({ url, opts });
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  };
  fn.calls = calls;
  return fn;
}
const jsonResponse = (obj, status) => ({
  ok: status === undefined ? true : status < 400,
  status: status || 200,
  json: () => Promise.resolve(obj)
});

const wn = {
  id: 'NJ-000123', customerName: '北京渔阳出租汽车集团', vehicleInfo: '京BD92708',
  faultDesc: 'EU5检测', engineer: '旧工程师', orderType: '检测'
};
const nw = {
  id: 'NW-000456', signedCustomer: '北京银建实业', plateNumber: '京BD20716',
  faultDesc: '电池包检修', repairEngineer: '罗永豪', projectType: '维修'
};

(async () => {
  console.log('\n== buildPayload ==');
  await ok('保内字段映射', () => {
    const p = N.buildPayload('WN', wn, '刘珍', '赵轩');
    assert.strictEqual(p.id, 'NJ-000123');
    assert.strictEqual(p.kind, '保内');
    assert.strictEqual(p.engineer, '刘珍');
    assert.strictEqual(p.customer, '北京渔阳出租汽车集团');
    assert.strictEqual(p.vehicle, '京BD92708');
    assert.strictEqual(p.fault, 'EU5检测');
    assert.strictEqual(p.operator, '赵轩');
  });
  await ok('保外字段映射', () => {
    const p = N.buildPayload('NW', nw, '', '刘晓');
    assert.strictEqual(p.id, 'NW-000456');
    assert.strictEqual(p.kind, '保外');
    assert.strictEqual(p.engineer, '罗永豪');
    assert.strictEqual(p.customer, '北京银建实业');
    assert.strictEqual(p.vehicle, '京BD20716');
    assert.strictEqual(p.fault, '电池包检修');
  });
  await ok('中文类型别名归一化', () => {
    assert.strictEqual(N.buildPayload('保内', wn).kind, '保内');
    assert.strictEqual(N.buildPayload('保外', nw).kind, '保外');
    assert.strictEqual(N.buildPayload('wn', wn).kind, '保内');
  });
  await ok('工程师入参优先于工单字段', () => {
    assert.strictEqual(N.buildPayload('WN', wn, '新工程师').engineer, '新工程师');
  });
  await ok('派单人缺省显示未署名', () => {
    assert.strictEqual(N.buildPayload('WN', wn, '刘珍', '').operator, '未署名');
  });
  await ok('缺失字段回退而非抛错', () => {
    const p = N.buildPayload('WN', {}, '');
    assert.strictEqual(p.id, '');
    assert.strictEqual(p.engineer, '');
    assert.strictEqual(p.customer, '');
    assert.strictEqual(p.fault, '');
  });
  await ok('id 可从 seq/orderNo 回退', () => {
    assert.strictEqual(N.buildPayload('WN', { seq: 'S-1', vehicleInfo: '京A' }).id, 'S-1');
    assert.strictEqual(N.buildPayload('NW', { orderNo: 'O-2', plateNumber: '京B' }).id, 'O-2');
  });
  await ok('不修改原始工单对象', () => {
    const copy = JSON.parse(JSON.stringify(wn));
    N.buildPayload('WN', wn, '刘珍', '赵轩');
    assert.deepStrictEqual(wn, copy);
  });
  await ok('时间可注入以保证确定性', () => {
    const d = new Date('2026-11-19T06:00:00Z');
    const t = N.buildPayload('WN', wn, '刘珍', '赵轩', d).time;
    assert.strictEqual(typeof t, 'string');
    assert.ok(t.length > 5);
  });

  console.log('\n== notify ==');
  await ok('成功时带上正确 URL、请求头与报文', async () => {
    const f = fakeFetch(jsonResponse({ ok: true, msg: '提醒已送达' }));
    const r = await N.notify('WN', wn, '刘珍', '赵轩', { fetchImpl: f, now: new Date('2026-11-19T14:00:00') });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(f.calls.length, 1);
    assert.strictEqual(f.calls[0].url, N.RELAY_URL);
    assert.strictEqual(f.calls[0].opts.method, 'POST');
    assert.strictEqual(f.calls[0].opts.headers['Content-Type'], 'application/json');
    assert.ok(f.calls[0].opts.headers['x-relay-key']);
    const body = JSON.parse(f.calls[0].opts.body);
    assert.strictEqual(body.id, 'NJ-000123');
    assert.strictEqual(body.engineer, '刘珍');
  });
  await ok('转发服务返回失败时 ok=false', async () => {
    const f = fakeFetch(jsonResponse({ ok: false, msg: '钉钉返回：限流' }));
    const r = await N.notify('WN', wn, '刘珍', '赵轩', { fetchImpl: f });
    assert.strictEqual(r.ok, false);
    assert.ok(r.msg.indexOf('限流') >= 0);
  });
  await ok('去重跳过被标记为 skipped', async () => {
    const f = fakeFetch(jsonResponse({ ok: true, skipped: true, msg: '已跳过' }));
    const r = await N.notify('WN', wn, '刘珍', '赵轩', { fetchImpl: f });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.skipped, true);
  });
  await ok('HTTP 错误被捕获为失败', async () => {
    const f = fakeFetch({ ok: false, status: 500 });
    const r = await N.notify('WN', wn, '刘珍', '赵轩', { fetchImpl: f });
    assert.strictEqual(r.ok, false);
    assert.ok(r.msg.indexOf('500') >= 0);
  });
  await ok('网络异常被捕获为失败', async () => {
    const f = fakeFetch(new Error('offline'));
    const r = await N.notify('WN', wn, '刘珍', '赵轩', { fetchImpl: f });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.msg, 'offline');
  });
  await ok('工单号或工程师为空时不发请求', async () => {
    const f = fakeFetch(jsonResponse({ ok: true }));
    const r = await N.notify('WN', { customerName: '无编号' }, '刘珍', '赵轩', { fetchImpl: f });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(f.calls.length, 0);
  });
  await ok('待跟进清单正文含工单与等待天数', async () => {
    const f = fakeFetch(jsonResponse({ ok: true, msg: '提醒已送达' }));
    const r = await N.sendDigest([
      { id: 'WN-000001', engineer: '刘珍', days: 5 },
      { id: 'WN-000002', engineer: '罗永豪', days: 1 }
    ], '王鹏', { fetchImpl: f, now: new Date('2026-11-19T14:00:00') });
    assert.strictEqual(r.ok, true);
    const body = JSON.parse(f.calls[0].opts.body);
    assert.strictEqual(body.id, 'DIGEST-20261119');
    assert.strictEqual(body.kind, '已接单未进行提醒');
    assert.ok(body.fault.indexOf('WN-000001') >= 0);
    assert.ok(body.fault.indexOf('已等待5天') >= 0);
    assert.ok(body.customer.indexOf('2 单') >= 0);
  });
  await ok('空清单也发送且写明暂无', async () => {
    const f = fakeFetch(jsonResponse({ ok: true }));
    await N.sendDigest([], '', { fetchImpl: f });
    const body = JSON.parse(f.calls[0].opts.body);
    assert.strictEqual(body.fault, '暂无');
    assert.strictEqual(body.operator, '系统');
  });
  await ok('清单推送失败时返回失败原因', async () => {
    const f = fakeFetch(jsonResponse({ ok: false, msg: '钉钉返回：限流' }));
    const r = await N.sendDigest([{ id: 'WN-1', days: 3 }], '王鹏', { fetchImpl: f });
    assert.strictEqual(r.ok, false);
    assert.ok(r.msg.indexOf('限流') >= 0);
  });
  await ok('自定义转发地址可用于隔离测试', async () => {
    const f = fakeFetch(jsonResponse({ ok: true }));
    const r = await N.notify('WN', wn, '刘珍', '赵轩', { fetchImpl: f, url: 'http://127.0.0.1:1/notify', key: 'test' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(f.calls[0].url, 'http://127.0.0.1:1/notify');
    assert.strictEqual(f.calls[0].opts.headers['x-relay-key'], 'test');
  });

  console.log('\n== 失败重试与 @ 名单 ==');
  await ok('网络抖动自动重试两次后仍失败', async () => {
    const f = fakeFetch(new Error('offline'));
    const r = await N.notify('WN', wn, '刘珍', '赵轩', { fetchImpl: f, retries: 2, retryDelay: 0 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(f.calls.length, 3);
  });
  await ok('首次 500、第二次成功则最终送达', async () => {
    let n = 0;
    const f = function () {
      n++;
      return n === 1
        ? Promise.resolve(jsonResponse({ ok: false }, 500))
        : Promise.resolve(jsonResponse({ ok: true, msg: '提醒已送达' }));
    };
    const calls = [];
    f.calls = calls;
    const r = await N.notify('WN', wn, '刘珍', '赵轩', { fetchImpl: f, retries: 2, retryDelay: 0 });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(n, 2);
  });
  await ok('业务失败不重试', async () => {
    const f = fakeFetch(jsonResponse({ ok: false, msg: '钉钉返回：参数错误' }));
    const r = await N.notify('WN', wn, '刘珍', '赵轩', { fetchImpl: f, retryDelay: 0 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(f.calls.length, 1);
  });
  await ok('force 模式在报文中标记跳过去重', async () => {
    const f = fakeFetch(jsonResponse({ ok: true, msg: '提醒已送达' }));
    await N.notify('WN', wn, '刘珍', '赵轩', { fetchImpl: f, force: true });
    assert.strictEqual(JSON.parse(f.calls[0].opts.body).force, true);
  });
  await ok('服务端 atMatched 回传到页面结果', async () => {
    const f = fakeFetch(jsonResponse({ ok: true, atMatched: true, msg: '提醒已送达并@刘珍' }));
    const r = await N.notify('WN', wn, '刘珍', '赵轩', { fetchImpl: f });
    assert.strictEqual(r.atMatched, true);
  });
  await ok('读取@名单走带口令的 GET', async () => {
    const f = fakeFetch(jsonResponse({ ok: true, directory: { '刘珍': { mobile: '13800138000' } } }));
    const r = await N.getAtDirectory({ fetchImpl: f, key: 'k1', url: 'http://local/notify' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.directory['刘珍'].mobile, '13800138000');
    assert.strictEqual(f.calls[0].opts.method, 'GET');
    assert.ok(f.calls[0].url.indexOf('key=k1') >= 0);
  });
  await ok('保存@名单提交完整映射', async () => {
    const f = fakeFetch(jsonResponse({ ok: true, persisted: true }));
    const r = await N.saveAtDirectory({ '刘珍': { mobile: '13800138000' } }, { fetchImpl: f, key: 'k2' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.persisted, true);
    assert.strictEqual(JSON.parse(f.calls[0].opts.body).directory['刘珍'].mobile, '13800138000');
  });

  console.log('\n----------------------------------------');
  console.log('PASS ' + pass + ' / FAIL ' + fail);
  process.exit(fail ? 1 : 0);
})();
