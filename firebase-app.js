/* ============================================
   Firebase init — with visible failure reporting.

   If firebase-config.js still has placeholder values, or the config is
   otherwise invalid, we do NOT let the app fail silently (which is what
   causes the "nothing happens when I click anything" symptom). Instead we
   show a clear on-screen banner explaining what to fix.
   ============================================ */
let auth = null;
let db = null;
let fbReady = false;
let fbInitError = null;

const STOCK_COLLECTION = 'stock';
const HISTORY_COLLECTION = 'history';
const HISTORY_FETCH_LIMIT = 500;

function configLooksUnset() {
  if (typeof firebaseConfig === 'undefined' || !firebaseConfig) return true;
  const values = Object.values(firebaseConfig);
  return values.some(v => !v || String(v).includes('วางค่าของคุณตรงนี้'));
}

function showFatalConfigError(message) {
  fbInitError = message;
  // Build the banner without relying on any other script having run yet.
  const el = document.createElement('div');
  el.id = 'fbFatalBanner';
  el.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:9999', 'background:#1f2430',
    'color:#faf7f0', 'display:flex', 'align-items:center', 'justify-content:center',
    'padding:24px', 'font-family:-apple-system,Segoe UI,Sarabun,sans-serif',
    'text-align:center'
  ].join(';');
  el.innerHTML = `
    <div style="max-width:440px;background:#fff;color:#1f2430;border:2px solid #1f2430;border-radius:10px;padding:24px;box-shadow:4px 4px 0 #9c7a3f;">
      <div style="font-size:1.1rem;font-weight:700;margin-bottom:10px;">⚠️ ตั้งค่า Firebase ไม่สำเร็จ</div>
      <div style="font-size:0.9rem;line-height:1.6;color:#4a5164;">${message}</div>
    </div>
  `;
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(el));
  if (document.body) document.body.appendChild(el);
}

try {
  if (typeof firebase === 'undefined') {
    showFatalConfigError('โหลด Firebase SDK ไม่สำเร็จ (เช็คว่าเชื่อมต่ออินเทอร์เน็ตอยู่ แล้วลองรีเฟรชหน้านี้)');
  } else if (configLooksUnset()) {
    showFatalConfigError('ยังไม่ได้ใส่ค่า Firebase config ตัวจริงในไฟล์ <code>firebase-config.js</code> (ยังเป็นค่าตัวอย่าง "วางค่าของคุณตรงนี้" อยู่) — เปิดไฟล์นั้นแล้วแทนที่ด้วย config จาก Firebase Console &gt; Project settings &gt; Your apps');
  } else {
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
    fbReady = true;
  }
} catch (err) {
  console.error('Firebase init error', err);
  showFatalConfigError(
    'เกิดข้อผิดพลาดตอนเชื่อมต่อ Firebase: <code>' + (err && err.message ? err.message : String(err)) +
    '</code><br><br>ลองเปิดไฟล์ <code>firebase-config.js</code> อีกครั้งแล้วตรวจว่าคัดลอกค่ามาครบถูกต้อง (ไม่มีเครื่องหมายคำพูดขาดหาย ไม่มีจุลภาคเกิน/ขาด)'
  );
}

/* ============================================
   Auth
   ============================================ */
function fbLogin(email, password) {
  if (!fbReady) return Promise.reject(new Error('Firebase ยังไม่พร้อมใช้งาน'));
  return auth.signInWithEmailAndPassword(email, password);
}

function fbRegister(email, password) {
  if (!fbReady) return Promise.reject(new Error('Firebase ยังไม่พร้อมใช้งาน'));
  return auth.createUserWithEmailAndPassword(email, password);
}

function fbLogout() {
  if (!fbReady) return Promise.resolve();
  return auth.signOut();
}

function onAuthChange(callback) {
  if (!fbReady) return;
  auth.onAuthStateChanged(callback);
}

/* ============================================
   Realtime listeners
   Both return an unsubscribe function.
   ============================================ */
function listenStock(onData, onError) {
  return db.collection(STOCK_COLLECTION).onSnapshot((snapshot) => {
    const map = {};
    snapshot.forEach(doc => {
      map[doc.id] = doc.data().qty || 0;
    });
    onData(map);
  }, onError);
}

function listenHistory(onData, onError) {
  return db.collection(HISTORY_COLLECTION)
    .orderBy('ts', 'desc')
    .limit(HISTORY_FETCH_LIMIT)
    .onSnapshot((snapshot) => {
      const list = snapshot.docs.map(doc => {
        const d = doc.data();
        return {
          id: doc.id,
          code: d.code,
          name: d.name,
          unit: d.unit,
          delta: d.delta,
          mode: d.mode,
          note: d.note || '',
          after: d.after,
          userEmail: d.userEmail || '',
          // ts may briefly be null right after a local write before the server
          // timestamp resolves; fall back to "now" so it renders immediately.
          ts: d.ts ? d.ts.toMillis() : Date.now()
        };
      });
      onData(list);
    }, onError);
}

/* ============================================
   Writes
   ============================================ */

// Atomically read-modify-write the stock qty and log a history entry in the
// same transaction, so two people adjusting the same item at the same
// moment can never clobber each other's change.
function fbAdjustQty(code, delta, meta, seedQty) {
  const stockRef = db.collection(STOCK_COLLECTION).doc(code);
  const historyRef = db.collection(HISTORY_COLLECTION).doc();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(stockRef);
    // If this product has never been written to Firestore before, don't
    // silently treat its "before" quantity as 0 — that would wipe stock
    // to 0 the first time anyone subtracts, regardless of what the app
    // was actually displaying. Fall back to the seed quantity the caller
    // saw on screen (originally sourced from data.js) instead.
    const before = snap.exists ? (snap.data().qty || 0) : (typeof seedQty === 'number' ? seedQty : 0);
    let after = before + delta;
    if (after < 0) after = 0;
    const actualDelta = after - before;

    tx.set(stockRef, {
      qty: after,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    tx.set(historyRef, {
      ...meta,
      delta: actualDelta,
      mode: actualDelta >= 0 ? 'in' : 'out',
      after,
      ts: firebase.firestore.FieldValue.serverTimestamp()
    });

    return after;
  });
}
