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
        '<div class="pwa-tabs">' +
          '<button type="button" id="pwaTabStaff" class="on">เจ้าหน้าที่</button>' +
          '<button type="button" id="pwaTabGuest">ผู้ช่วยประเมิน (อสม.)</button>' +
        '</div>' +
        '<div id="pwaStaffForm">' +
          '<input id="pwaUser" placeholder="ชื่อผู้ใช้ / เลขบัตรประชาชน" autocomplete="username">' +
          '<input id="pwaPass" type="password" placeholder="รหัสผ่าน" autocomplete="current-password">' +
          '<button id="pwaLoginBtn">เข้าสู่ระบบ</button>' +
        '</div>' +
        '<div id="pwaGuestForm" class="hidden">' +
          '<p class="pwa-sub" style="margin:2px 0 0">ไม่ต้องมีรหัสผ่าน — กรอกข้อมูลผู้ประเมินเพื่อยืนยันตัวตน (ใช้งานออฟไลน์ได้)</p>' +
          '<input id="pwaGCid" inputmode="numeric" maxlength="13" placeholder="เลขบัตรประชาชนผู้ประเมิน (13 หลัก)">' +
          '<input id="pwaGName" placeholder="ชื่อ-สกุลผู้ประเมิน">' +
          '<select id="pwaGPosSel">' +
            '<option value="อสม.">อสม.</option>' +
            '<option value="เจ้าหน้าที่">เจ้าหน้าที่</option>' +
          '</select>' +
          '<input id="pwaGPosOther" class="hidden" placeholder="ระบุตำแหน่ง (เช่น พยาบาลวิชาชีพ, แพทย์แผนไทย)">' +
          '<input id="pwaGAff" placeholder="ต้นสังกัด (เช่น รพ.สต.ระแว้ง)">' +
          '<button id="pwaGuestBtn">เริ่มประเมิน</button>' +
        '</div>' +
        '<div id="pwaLoginErr" class="pwa-err"></div>' +
        (ENDPOINT ? '' : '<div class="pwa-err">⚠️ ยังไม่ได้ตั้งค่า apiUrl ใน config.js</div>') +
      '</div>';
    document.body.appendChild(el);
    var err = document.getElementById('pwaLoginErr');

    // สลับแท็บ เจ้าหน้าที่ / ผู้ช่วยประเมิน
    var tabS = document.getElementById('pwaTabStaff'), tabG = document.getElementById('pwaTabGuest');
    var formS = document.getElementById('pwaStaffForm'), formG = document.getElementById('pwaGuestForm');
    function show(guest) {
      formS.classList.toggle('hidden', guest); formG.classList.toggle('hidden', !guest);
      tabS.classList.toggle('on', !guest); tabG.classList.toggle('on', guest);
      err.textContent = '';
    }
    tabS.addEventListener('click', function () { show(false); });
    tabG.addEventListener('click', function () { show(true); });

    // เข้าสู่ระบบ (เจ้าหน้าที่)
    var btn = document.getElementById('pwaLoginBtn');
    function doLogin() {
      var u = document.getElementById('pwaUser').value.trim();
      var p = document.getElementById('pwaPass').value;
      if (!u || !p) { err.textContent = 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน'; return; }
      btn.disabled = true; btn.textContent = 'กำลังตรวจสอบ...'; err.textContent = '';
      apiCall('authenticate', [u, p]).then(function (r) {
        if (!r || !r.ok) { err.textContent = (r && r.message) || 'เข้าสู่ระบบไม่สำเร็จ'; btn.disabled = false; btn.textContent = 'เข้าสู่ระบบ'; return; }
        setAuth({ token: r.token, by: r.displayName || u, role: r.role || '' });
        location.reload();
      }, function (e) {
        err.textContent = 'เชื่อมต่อไม่ได้: ' + (e && e.message || e) + ' (ตรวจ apiUrl/อินเทอร์เน็ต)';
        btn.disabled = false; btn.textContent = 'เข้าสู่ระบบ';
      });
    }
    btn.addEventListener('click', doLogin);
    document.getElementById('pwaPass').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });

    // ผู้ช่วยประเมิน (อสม.) — เปิดตลอด + ออฟไลน์ได้
    var gbtn = document.getElementById('pwaGuestBtn');
    function doGuest() {
      var cid = (document.getElementById('pwaGCid').value || '').replace(/\D/g, '');
      var name = document.getElementById('pwaGName').value.trim();
      var posSel = document.getElementById('pwaGPosSel').value;
      var pos = posSel;
      if (posSel === 'เจ้าหน้าที่') {
        pos = document.getElementById('pwaGPosOther').value.trim();
        if (!pos) { err.textContent = 'กรุณาระบุตำแหน่งเจ้าหน้าที่ (เช่น พยาบาลวิชาชีพ)'; return; }
      }
      var aff = document.getElementById('pwaGAff').value.trim();
      if (cid.length !== 13) { err.textContent = 'กรอกเลขบัตรประชาชนผู้ประเมิน 13 หลัก'; return; }
      if (!name || !aff) { err.textContent = 'กรอกชื่อ-สกุล และต้นสังกัดให้ครบ'; return; }
      var display = name + ' (' + pos + ' · ' + aff + ')';
      gbtn.disabled = true; gbtn.textContent = 'กำลังเข้า...'; err.textContent = '';
      apiCall('guestLogin', [{ cid: cid, name: name, position: pos, affiliation: aff }]).then(function (r) {
        if (!r || !r.ok) { err.textContent = (r && r.message) || 'เข้าใช้งานไม่สำเร็จ'; gbtn.disabled = false; gbtn.textContent = 'เริ่มประเมิน'; return; }
        setAuth({ token: r.token, by: r.displayName || display, role: 'GUEST', guest: true, cid: cid });
        location.reload();
      }, function () {
        // ออฟไลน์: เริ่มแบบในเครื่องก่อน (ไม่มีโทเค็น) — บันทึกเก็บไว้ ซิงค์อัตโนมัติเมื่อมีเน็ต
        setAuth({ token: '', by: display, role: 'GUEST', guest: true, cid: cid, offline: true });
        location.reload();
      });
    }
    gbtn.addEventListener('click', doGuest);

    // ตำแหน่ง: เลือก "เจ้าหน้าที่" → โชว์ช่องระบุวิชาชีพ
    var posSel = document.getElementById('pwaGPosSel');
    var posOther = document.getElementById('pwaGPosOther');
    posSel.addEventListener('change', function () {
      var staff = posSel.value === 'เจ้าหน้าที่';
      posOther.classList.toggle('hidden', !staff);
      if (staff) posOther.focus();
    });
  }

  function buildTopbar() {
    var bar = document.createElement('div');
    bar.id = 'pwaTopbar';
    bar.innerHTML =
      '<span class="pwa-tb-logo"></span>' +
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
  function showUpdateBanner() {
    if (document.getElementById('pwaUpd')) return;
    var b = document.createElement('div');
    b.id = 'pwaUpd'; b.className = 'show';
    b.textContent = '✨ มีเวอร์ชันใหม่ • แตะเพื่ออัปเดต';
    b.addEventListener('click', function () { location.reload(); });
    document.body.appendChild(b);
  }
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').then(function (reg) {
        reg.addEventListener('updatefound', function () {
          var nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', function () {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner();
          });
        });
      }).catch(function (e) { console.warn('SW register failed', e); });
    });
  }

  /* ---------- ประกอบ UI ตามสถานะล็อกอิน ---------- */
  ready(function () {
    if (!auth) { buildLoginOverlay(); }
    else { buildTopbar(); }
  });
})();
