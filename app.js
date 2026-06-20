/* =====================================================================
 *  app.js — สะพานเชื่อม PWA ↔ GAS + login + สแกน QR + service worker
 *  โหลด "ก่อน" สคริปต์หลักของ Assess เสมอ (build_pwa.py วางไว้ให้แล้ว)
 *
 *  หัวใจ: สร้าง window.google.script.run ปลอม (shim) ที่ route ไป GAS JSON API
 *  ด้วย fetch → ทำให้ gasAvailable() ในหน้าประเมินเป็น true และระบบ outbox/
 *  ซิงค์เดิมทำงานต่อได้ทันที (ออฟไลน์ = fetch ล้มเหลว → outbox retry เอง)
 * ===================================================================== */
(function () {
  'use strict';
  var CFG = window.PWA_CONFIG || {};
  var ENDPOINT = (CFG.proxyUrl && CFG.proxyUrl.trim()) || (CFG.apiUrl && CFG.apiUrl.trim()) || '';
  var LS_AUTH = 'eldpwa_auth_v1';
  var API_METHODS = ['authenticate', 'saveElderlyAssessmentModule', 'getElderlyPatientRecord',
                     'createReferral', 'nextClinicDates', 'ping'];

  /* ---------- เรียก GAS JSON API (POST text/plain = simple request เลี่ยง preflight) ---------- */
  function apiCall(method, args) {
    if (!ENDPOINT) return Promise.reject(new Error('ยังไม่ได้ตั้งค่า apiUrl ใน config.js'));
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ method: method, args: args || [] })
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }
  window.pwaApiCall = apiCall;

  /* ---------- shim: google.script.run ---------- */
  function makeRunner() {
    var onOk = null, onErr = null;
    var runner = {
      withSuccessHandler: function (fn) { onOk = fn; return runner; },
      withFailureHandler: function (fn) { onErr = fn; return runner; }
    };
    API_METHODS.forEach(function (m) {
      runner[m] = function () {
        var args = Array.prototype.slice.call(arguments);
        apiCall(m, args).then(
          function (r) { if (onOk) onOk(r); },
          function (e) { if (onErr) onErr(e); }
        );
        return runner;
      };
    });
    return runner;
  }
  window.google = window.google || {};
  window.google.script = window.google.script || {};
  Object.defineProperty(window.google.script, 'run', { configurable: true, get: makeRunner });

  /* ---------- auth (localStorage) ---------- */
  function getAuth() { try { return JSON.parse(localStorage.getItem(LS_AUTH) || 'null'); } catch (e) { return null; } }
  function setAuth(a) { localStorage.setItem(LS_AUTH, JSON.stringify(a)); }
  function clearAuth() { localStorage.removeItem(LS_AUTH); }

  // ฉีดข้อมูลล็อกอินเข้า window.__SP "ก่อน" สคริปต์หลักอ่าน (สำคัญ)
  var auth = getAuth();
  window.__SP = auth ? { token: auth.token, by: auth.by, role: auth.role } : {};
  if (auth) { window.__pocToken = auth.token; window.__pocBy = auth.by; window.__pocRole = auth.role; }

  /* ---------- UI: login overlay + topbar + QR modal (สร้างเมื่อ DOM พร้อม) ---------- */
  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  function buildLoginOverlay() {
    var el = document.createElement('div');
    el.id = 'pwaLogin';
    el.innerHTML =
      '<div class="pwa-card">' +
        '<div class="pwa-logo"></div>' +
        '<h2>' + (CFG.clinicName || 'คลินิกผู้สูงอายุ') + '</h2>' +
        '<p class="pwa-sub">เข้าสู่ระบบเพื่อประเมิน (ใช้งานออฟไลน์ได้หลังเข้าครั้งแรก)</p>' +
        '<input id="pwaUser" placeholder="ชื่อผู้ใช้ / เลขบัตรประชาชน" autocomplete="username">' +
        '<input id="pwaPass" type="password" placeholder="รหัสผ่าน" autocomplete="current-password">' +
        '<button id="pwaLoginBtn">เข้าสู่ระบบ</button>' +
        '<div id="pwaLoginErr" class="pwa-err"></div>' +
        (ENDPOINT ? '' : '<div class="pwa-err">⚠️ ยังไม่ได้ตั้งค่า apiUrl ใน config.js</div>') +
      '</div>';
    document.body.appendChild(el);
    var btn = document.getElementById('pwaLoginBtn');
    var err = document.getElementById('pwaLoginErr');
    function doLogin() {
      var u = document.getElementById('pwaUser').value.trim();
      var p = document.getElementById('pwaPass').value;
      if (!u || !p) { err.textContent = 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน'; return; }
      btn.disabled = true; btn.textContent = 'กำลังตรวจสอบ...'; err.textContent = '';
      apiCall('authenticate', [u, p]).then(function (r) {
        if (!r || !r.ok) { err.textContent = (r && r.message) || 'เข้าสู่ระบบไม่สำเร็จ'; btn.disabled = false; btn.textContent = 'เข้าสู่ระบบ'; return; }
        setAuth({ token: r.token, by: r.displayName || u, role: r.role || '' });
        location.reload();   // โหลดใหม่ → __SP ติดก่อนสคริปต์หลัก
      }, function (e) {
        err.textContent = 'เชื่อมต่อไม่ได้: ' + (e && e.message || e) + ' (ตรวจ apiUrl/อินเทอร์เน็ต)';
        btn.disabled = false; btn.textContent = 'เข้าสู่ระบบ';
      });
    }
    btn.addEventListener('click', doLogin);
    document.getElementById('pwaPass').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
  }

  function buildTopbar() {
    var bar = document.createElement('div');
    bar.id = 'pwaTopbar';
    bar.innerHTML =
      '<span class="pwa-who">👤 ' + (auth ? (auth.by || '') : '') + '</span>' +
      '<button id="pwaLogout" class="pwa-mini">ออกจากระบบ</button>';
    document.body.appendChild(bar);
    document.body.classList.add('pwa-has-topbar');
    document.getElementById('pwaLogout').addEventListener('click', function () {
      if (confirm('ออกจากระบบ? ข้อมูลที่ยังไม่ซิงค์จะถูกเก็บไว้ในเครื่อง')) { clearAuth(); location.reload(); }
    });
  }

  /* ---------- สแกน QR (lazy-load html5-qrcode) ---------- */
  var qrLib = null;
  function loadQrLib() {
    if (qrLib) return Promise.resolve(qrLib);
    if (window.Html5Qrcode) { qrLib = window.Html5Qrcode; return Promise.resolve(qrLib); }
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js';
      s.onload = function () { qrLib = window.Html5Qrcode; resolve(qrLib); };
      s.onerror = function () { reject(new Error('โหลดตัวสแกนไม่ได้ (ต้องมีเน็ตครั้งแรก)')); };
      document.head.appendChild(s);
    });
  }
  function parseCID(text) {
    var m = String(text || '').match(/CID[:\s]*([0-9]{13})/i);
    if (m) return m[1];
    var digits = String(text || '').replace(/[^0-9]/g, '');
    return (digits.length === 13) ? digits : '';
  }
  var scanner = null;
  function openScanner() {
    var modal = document.createElement('div');
    modal.id = 'pwaScan';
    modal.innerHTML =
      '<div class="pwa-scan-card">' +
        '<div class="pwa-scan-head">สแกน QR บัตรผู้ป่วย <button id="pwaScanClose" class="pwa-mini">ปิด</button></div>' +
        '<div id="qr-reader" style="width:100%"></div>' +
        '<div id="pwaScanMsg" class="pwa-sub" style="margin-top:8px">เล็งกล้องไปที่ QR บนบัตรประจำตัวผู้ป่วย</div>' +
      '</div>';
    document.body.appendChild(modal);
    function close() {
      try { if (scanner) scanner.stop().then(function () { scanner.clear(); }); } catch (e) {}
      scanner = null;
      if (modal.parentNode) modal.parentNode.removeChild(modal);
    }
    document.getElementById('pwaScanClose').addEventListener('click', close);
    var msg = document.getElementById('pwaScanMsg');
    loadQrLib().then(function (H) {
      scanner = new H('qr-reader');
      scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: 240 },
        function (decoded) {
          var cid = parseCID(decoded);
          if (!cid) { msg.textContent = '⚠️ ไม่พบเลขบัตร 13 หลักใน QR นี้'; return; }
          var input = document.getElementById('cid');
          if (input) { input.value = cid; if (input.onblur) input.onblur(); else if (typeof peekCase === 'function') peekCase(); }
          close();
        },
        function () {}
      ).catch(function (e) { msg.textContent = '⚠️ เปิดกล้องไม่ได้: ' + (e && e.message || e); });
    }).catch(function (e) { msg.textContent = '⚠️ ' + (e && e.message || e); });
  }
  window.pwaScanCID = openScanner;

  /* ---------- service worker ---------- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function (e) { console.warn('SW register failed', e); });
    });
  }

  /* ---------- ประกอบ UI ตามสถานะล็อกอิน ---------- */
  ready(function () {
    if (!auth) { buildLoginOverlay(); }
    else { buildTopbar(); }
  });
})();
