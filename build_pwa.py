#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ประกอบ index.html ของ PWA จาก Assess.html เดิม (ใช้เอนจินประเมินซ้ำทั้งดุ้น)
- inline ThaiAddressData
- แทน <?!= qp ?> ด้วยการโหลด config.js + app.js (shim/login/QR/SW) ก่อนสคริปต์หลัก
- ฉีด <head> ของ PWA (manifest/theme/CSS overlay) + ปุ่มสแกน QR ข้างช่อง CID
รัน: python3 build_pwa.py
"""
import pathlib, sys

PWA = pathlib.Path(__file__).parent
SRC = PWA.parent / 'elderly-dashboard'

def read(p):
    return (SRC / p).read_text(encoding='utf-8')

def need(haystack, marker):
    if marker not in haystack:
        sys.exit('❌ ไม่พบ marker ในไฟล์ต้นทาง: ' + marker)

html = read('Assess.html')

# 1) inline ThaiAddressData (Assess เดิมใช้ <?!= include('ThaiAddressData') ?>)
inc = "<?!= include('ThaiAddressData') ?>"
need(html, inc)
html = html.replace(inc, read('ThaiAddressData.html'))

# 2) แทนบรรทัด __SP (server template) ด้วยสคริปต์ฝั่ง PWA (โหลด "ก่อน" สคริปต์หลัก)
sp_line = "<script>window.__SP = <?!= qp ?>;</script>"
need(html, sp_line)
html = html.replace(sp_line, '<script src="config.js"></script>\n<script src="app.js"></script>')

# 3) ฉีด PWA head ก่อน </head>
PWA_HEAD = """
<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#05070f">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="ประเมินผู้สูงอายุ">
<link rel="apple-touch-icon" href="icons/icon-192.png">
<style>
  body.pwa-has-topbar{padding-top:42px}
  #pwaTopbar{position:fixed;top:0;left:0;right:0;height:42px;z-index:60;display:flex;align-items:center;gap:10px;
    padding:0 14px;background:rgba(5,7,15,.82);backdrop-filter:blur(10px);border-bottom:1px solid rgba(125,211,252,.15)}
  #pwaTopbar .pwa-who{font-size:13px;color:#9fb0d0;margin-right:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pwa-mini{background:rgba(251,113,133,.12);color:#fb7185;border:1px solid rgba(251,113,133,.35);
    border-radius:9px;padding:6px 12px;font-family:inherit;font-size:12px;cursor:pointer}
  #pwaLogin{position:fixed;inset:0;z-index:200;display:grid;place-items:center;padding:22px;
    background:radial-gradient(60% 60% at 50% 20%,rgba(14,21,48,.96),rgba(5,7,15,.98))}
  #pwaLogin .pwa-card{width:100%;max-width:380px;background:rgba(18,26,48,.7);border:1px solid rgba(125,211,252,.2);
    border-radius:22px;padding:28px 24px;box-shadow:0 18px 50px rgba(0,0,0,.55);text-align:center}
  #pwaLogin .pwa-logo{width:62px;height:62px;margin:0 auto 14px;border-radius:18px;
    background:radial-gradient(circle at 30% 25%,#5eead4,#38bdf8);box-shadow:0 0 26px rgba(94,234,212,.5)}
  #pwaLogin h2{font-size:18px;color:#e8eefc;margin-bottom:6px}
  .pwa-sub{font-size:12.5px;color:#9fb0d0;line-height:1.5}
  #pwaLogin input{width:100%;margin-top:12px;padding:13px 14px;border-radius:12px;background:rgba(7,11,22,.7);
    border:1px solid rgba(125,211,252,.22);color:#e8eefc;font-family:inherit;font-size:15px}
  #pwaLogin button{width:100%;margin-top:16px;padding:13px;border:none;border-radius:12px;cursor:pointer;
    font-family:inherit;font-size:15px;font-weight:600;color:#03121a;background:linear-gradient(120deg,#5eead4,#38bdf8)}
  #pwaLogin button:disabled{opacity:.6}
  .pwa-err{color:#fb7185;font-size:12.5px;margin-top:10px;min-height:16px}
  .pwa-scanbtn{margin-top:6px;padding:9px 12px;border-radius:10px;cursor:pointer;font-family:inherit;font-size:13px;
    color:#5eead4;background:rgba(94,234,212,.1);border:1px solid rgba(94,234,212,.35)}
  #pwaScan{position:fixed;inset:0;z-index:210;display:grid;place-items:center;padding:18px;background:rgba(5,7,15,.92)}
  #pwaScan .pwa-scan-card{width:100%;max-width:420px;background:rgba(18,26,48,.92);border:1px solid rgba(125,211,252,.2);
    border-radius:18px;padding:16px}
  #pwaScan .pwa-scan-head{display:flex;align-items:center;justify-content:space-between;color:#e8eefc;font-size:15px;margin-bottom:12px}
</style>
"""
need(html, "</head>")
html = html.replace("</head>", PWA_HEAD + "</head>", 1)

# 4) ปุ่มสแกน QR ข้างช่อง CID
cid_fld = '<div class="fld"><label>เลขบัตรประชาชน</label><input id="cid" inputmode="numeric" maxlength="13" placeholder="13 หลัก" onblur="peekCase()"></div>'
need(html, cid_fld)
cid_new = ('<div class="fld"><label>เลขบัตรประชาชน</label>'
           '<input id="cid" inputmode="numeric" maxlength="13" placeholder="13 หลัก" onblur="peekCase()">'
           '<button type="button" class="pwa-scanbtn" onclick="pwaScanCID()">📷 สแกน QR บัตรผู้ป่วย</button></div>')
html = html.replace(cid_fld, cid_new)

# 5) ปรับ title
html = html.replace('ประเมินคลินิกผู้สูงอายุ • ยะรัง (ตัวอย่างเร็ว)', 'ประเมินผู้สูงอายุ • รพ.ยะรัง')

(PWA / 'index.html').write_text(html, encoding='utf-8')
print('✓ wrote elderly-pwa/index.html (', len(html), 'bytes )')
