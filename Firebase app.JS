/* ============================================
   Firebase init
   ============================================ */
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const STOCK_COLLECTION = 'stock';
const HISTORY_COLLECTION = 'history';
const HISTORY_FETCH_LIMIT = 500;

/* ============================================
   Auth
   ============================================ */
function fbLogin(email, password) {
  return auth.signInWithEmailAndPassword(email, password);
}

function fbLogout() {
  return auth.signOut();
}

function onAuthChange(callback) {
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
function fbAdjustQty(code, delta, meta) {
  const stockRef = db.collection(STOCK_COLLECTION).doc(code);
  const historyRef = db.collection(HISTORY_COLLECTION).doc();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(stockRef);
    const before = snap.exists ? (snap.data().qty || 0) : 0;
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