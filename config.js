/* =====================================================================
 *  ตั้งค่า PWA — ใส่ URL ของ GAS Web App (exec) ที่ deploy แล้วตรงนี้
 *  หาได้จาก: Apps Script → Deploy → Manage deployments → Web app → URL
 *  (ลงท้ายด้วย /exec)  เช่น https://script.google.com/macros/s/XXXX/exec
 *
 *  ถ้าเรียกตรงแล้วเบราว์เซอร์บล็อก CORS (อ่าน response ไม่ได้):
 *    ตั้ง proxyUrl เป็น Cloudflare Worker ที่ forward ไป GAS + เติม
 *    header Access-Control-Allow-Origin: *  (ดู README_PWA.md)
 * ===================================================================== */
window.PWA_CONFIG = {
  apiUrl: "https://script.google.com/macros/s/AKfycbxr907c_AbrgUXywKiOD9SKGULrzTMrgTRl1G_KETHzz2Mj3gh6RKRqMyTDFt25s0kldQ/exec",  // /exec URL
  proxyUrl: "",      // <-- (ถ้าจำเป็น) URL ของ proxy; ถ้าตั้งไว้จะใช้แทน apiUrl
  clinicName: "คลินิกผู้สูงอายุ โรงพยาบาลยะรัง"
};
