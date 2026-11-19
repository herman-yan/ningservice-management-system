/* 宁家工单 · 派单钉钉提醒（浏览器侧）
 * 职责：把派单事实整理成payload，调用转发服务；不碰 DOM、不碰存储，便于单测。
 * 加签密钥只存在转发服务端，本文件不含密钥。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DISPATCH_NOTIFY = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var RELAY_URL = 'https://nj-dispatch-relay.app.workbuddy.host/notify?sharecode=6OF6AIIPFN';
  var RELAY_KEY = 'njRelay_2026_9d4f7a1c6b8e2d50';

  function clean(v) {
    return String(v == null ? '' : v).trim();
  }

  function pick(o, keys) {
    for (var i = 0; i < keys.length; i++) {
      var v = clean(o && o[keys[i]]);
      if (v) return v;
    }
    return '';
  }

  function localTime(d) {
    try {
      return (d || new Date()).toLocaleString('zh-CN', { hour12: false });
    } catch (e) {
      return String(d || new Date());
    }
  }

  function buildPayload(kind, order, engineer, operator, now) {
    var o = order || {};
    var isWn = kind === 'WN' || kind === '保内' || kind === 'wn';
    return {
      id: pick(o, ['id', 'seq', 'orderNo', 'gssOrderNo']),
      kind: isWn ? '保内' : '保外',
      engineer: clean(engineer) || pick(o, ['engineer', 'repairEngineer']),
      customer: isWn
        ? pick(o, ['customerName', 'customer', 'contactName'])
        : pick(o, ['signedCustomer', 'customerName', 'customer', 'bizContact']),
      vehicle: isWn
        ? pick(o, ['vehicleInfo', 'plateNumber', 'carNo'])
        : pick(o, ['plateNumber', 'vehicleInfo', 'vin', 'barcode']),
      fault: pick(o, ['faultDesc', 'projectType', 'orderType', 'fault', 'remark']),
      operator: clean(operator) || '未署名',
      time: localTime(now)
    };
  }

  function postPayload(payload, opts) {
    opts = opts || {};
    if (!payload.id || !payload.engineer) {
      return Promise.resolve({ ok: false, msg: '工单编号或工程师为空', payload: payload });
    }
    var fetchFn = opts.fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!fetchFn) {
      return Promise.resolve({ ok: false, msg: '当前环境不支持网络提醒', payload: payload });
    }
    var url = opts.url || RELAY_URL;
    var key = Object.prototype.hasOwnProperty.call(opts, 'key') ? opts.key : RELAY_KEY;

    return Promise.resolve()
      .then(function () {
        return fetchFn(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-relay-key': key },
          body: JSON.stringify(payload),
          credentials: 'omit',
          cache: 'no-store'
        });
      })
      .then(function (r) {
        if (!r || !r.ok) throw new Error('转发服务返回 ' + (r && r.status ? r.status : '无响应'));
        return r.json();
      })
      .then(function (j) {
        return {
          ok: !!(j && j.ok),
          skipped: !!(j && j.skipped),
          msg: (j && (j.msg || j.errmsg)) || '未知结果',
          payload: payload
        };
      })
      .catch(function (e) {
        return { ok: false, msg: (e && e.message) || '发送失败', payload: payload };
      });
  }

  function notify(kind, order, engineer, operator, opts) {
    opts = opts || {};
    return postPayload(buildPayload(kind, order, engineer, operator, opts.now), opts);
  }

  // 「已接单未进行」每日清单：仍然走同一条转发通道，正文列出工单与等待天数。
  function sendDigest(items, operator, opts) {
    opts = opts || {};
    var list = Array.isArray(items) ? items : [];
    var lines = list.slice(0, 20).map(function (x) {
      return (x.id || '?') + '（' + (x.engineer || '未指派') + '，已等待' + (x.days || 0) + '天）';
    }).join('；');
    var d = opts.now || new Date();
    var stamp = String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    var payload = {
      id: 'DIGEST-' + stamp,
      kind: '已接单未进行提醒',
      engineer: '当班负责人',
      customer: '共 ' + list.length + ' 单未开工',
      vehicle: '—',
      fault: lines || '暂无',
      operator: clean(operator) || '系统',
      time: localTime(d)
    };
    return postPayload(payload, opts);
  }

  return {
    RELAY_URL: RELAY_URL,
    buildPayload: buildPayload,
    notify: notify,
    sendDigest: sendDigest
  };
});
