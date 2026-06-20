# PWA ประเมินผู้สูงอายุ (front-end แยก + GAS เป็น API)

แอปประเมินผู้สูงอายุแบบ **ติดตั้งได้ + ใช้งานออฟไลน์** สำหรับ อสม./เจ้าหน้าที่ลงพื้นที่
ใช้ "เอนจินประเมินเดิม" จาก `Assess.html` ทั้งดุ้น (โค้ดคลินิกไม่เปลี่ยน) — เปลี่ยนแค่ชั้นข้อมูล
ให้คุยกับ GAS ผ่าน JSON API + เพิ่ม Service Worker/manifest/login/สแกน QR

```
PWA (GitHub Pages/Firebase, HTTPS)
   │  fetch POST text/plain  {"method","args"}
   ▼
GAS Web App  doPost(e) → apiDispatch_ → ฟังก์ชันเดิม → JSON
```

## โครงไฟล์
| ไฟล์ | หน้าที่ |
|---|---|
| `index.html` | **สร้างอัตโนมัติ** ด้วย `build_pwa.py` (Assess.html + ThaiAddressData + shim/login/QR) — อย่าแก้มือ |
| `app.js` | shim `google.script.run`→fetch, login, สแกน QR, ลงทะเบียน SW |
| `sw.js` | Service Worker (แคชแอปเชลล์ → เปิดออฟไลน์ได้) |
| `manifest.webmanifest` | ข้อมูลติดตั้งแอป + ไอคอน |
| `config.js` | **ใส่ URL ของ GAS API ที่นี่** |
| `icons/` | ไอคอน 192/512 + maskable (สร้างจาก logo_clinic.png) |
| `build_pwa.py` | สคริปต์ประกอบ index.html |

## ขั้นตอนเปิดใช้

### 1) Deploy GAS (ฝั่ง API) — ทำครั้งเดียว
โค้ด API อยู่ใน `Code.gs` แล้ว (`doPost`, `doGet?api=ping`, `apiDispatch_`, allowlist `API_METHODS_`).
- วาง Code.gs เวอร์ชันล่าสุด → **Deploy → New version**
- Execute as: **Me**, Who has access: **Anyone** (จำเป็นให้ PWA เรียกได้)
- คัดลอก **Web app URL** (ลงท้าย `/exec`)

### 2) ตั้งค่า `config.js`
```js
window.PWA_CONFIG = { apiUrl: "https://script.google.com/macros/s/XXXX/exec", proxyUrl: "", ... };
```

### 3) ทดสอบ CORS (สำคัญ — ทำก่อนลงทุน host)
เปิดหน้านี้บนเครื่อง (หลัง host หรือทดสอบ local) แล้วลองล็อกอิน หรือเปิด console:
```js
fetch(PWA_CONFIG.apiUrl + "?api=ping").then(r=>r.json()).then(console.log)
```
- **อ่านผลได้** → CORS ผ่าน ใช้ต่อได้เลย
- **ถูกบล็อก (CORS error)** → ไปขั้นตอน 3b (proxy)

### 3b) (ถ้าจำเป็น) Cloudflare Worker proxy เติม header CORS
สมัคร Cloudflare (ฟรี) → Workers → สร้าง worker:
```js
export default {
  async fetch(req) {
    const GAS = "https://script.google.com/macros/s/XXXX/exec";
    const url = new URL(req.url);
    const target = GAS + url.search;
    const init = { method: req.method, headers: { "Content-Type": "text/plain;charset=utf-8" } };
    if (req.method === "POST") init.body = await req.text();
    const res = await fetch(target, init);
    const body = await res.text();
    return new Response(body, { headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }});
  }
}
```
แล้วตั้ง `proxyUrl` ใน config.js เป็น URL ของ worker (จะถูกใช้แทน apiUrl อัตโนมัติ)

### 4) Host static (เลือกอย่างใดอย่างหนึ่ง)
- **GitHub Pages**: push โฟลเดอร์นี้ขึ้น repo → Settings → Pages → Deploy from branch
- **Firebase Hosting**: `firebase init hosting` (public = โฟลเดอร์นี้) → `firebase deploy`
> ต้องเป็น **HTTPS** เท่านั้น Service Worker + กล้องถึงทำงาน (localhost ก็ได้ตอนทดสอบ)

### 5) ติดตั้งบนมือถือ
เปิด URL ในเบราว์เซอร์ → เมนู → "เพิ่มไปยังหน้าจอหลัก / Install app"

## การแก้ไข/อัปเดต
แก้ที่ `Assess.html` (เอนจินประเมิน) หรือ `app.js`/`sw.js` แล้ว **รัน `python3 build_pwa.py` ใหม่**
และ **เปลี่ยนเลขเวอร์ชัน `CACHE` ใน sw.js** (เช่น `eld-pwa-v1`→`v2`) เพื่อล้างแคชเก่าบนเครื่องผู้ใช้

## หมายเหตุ
- **ออฟไลน์**: หน้าประเมินมีระบบ outbox อยู่แล้ว — กรอก/บันทึกตอนไม่มีเน็ตได้ ข้อมูลเก็บใน localStorage แล้วซิงค์อัตโนมัติเมื่อกลับมาออนไลน์ (ฟัง event `online`)
- **สแกน QR**: อ่าน **QR บัตรประจำตัวผู้ป่วยที่ระบบพิมพ์** (มี `CID:xxxxxxxxxxxxx`) → เติมเลขบัตรอัตโนมัติ ไม่ใช่บาร์โค้ด PDF417 บนบัตรประชาชนราชการ (คนละมาตรฐาน)
- **กล้อง**: ทำงานเฉพาะบน HTTPS/อุปกรณ์จริง (ทดสอบ headless ไม่ได้)
