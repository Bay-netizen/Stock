/* ============================================
   DOM refs
   ============================================ */
const tabLogin = document.getElementById('tabLogin');
const tabRegister = document.getElementById('tabRegister');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const formSub = document.getElementById('formSub');
const formError = document.getElementById('formError');
const formSuccess = document.getElementById('formSuccess');

const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const loginSubmit = document.getElementById('loginSubmit');

const registerEmail = document.getElementById('registerEmail');
const registerPassword = document.getElementById('registerPassword');
const registerPasswordConfirm = document.getElementById('registerPasswordConfirm');
const registerSubmit = document.getElementById('registerSubmit');

let mode = 'login';

/* ============================================
   If already logged in, skip straight to the app.
   ============================================ */
onAuthChange((user) => {
  if (user) {
    window.location.replace('index.html');
  }
});

/* ============================================
   Tab switching
   ============================================ */
function setMode(newMode) {
  mode = newMode;
  const isLogin = mode === 'login';

  tabLogin.classList.toggle('active', isLogin);
  tabRegister.classList.toggle('active', !isLogin);
  loginForm.hidden = !isLogin;
  registerForm.hidden = isLogin;
  formSub.textContent = isLogin
    ? 'เข้าสู่ระบบเพื่อจัดการจำนวนสินค้า'
    : 'สร้างบัญชีใหม่สำหรับพนักงาน';

  clearMessages();
}

tabLogin.addEventListener('click', () => setMode('login'));
tabRegister.addEventListener('click', () => setMode('register'));

/* ============================================
   Messages
   ============================================ */
function clearMessages() {
  formError.hidden = true;
  formSuccess.hidden = true;
}

function showError(msg) {
  formError.textContent = msg;
  formError.hidden = false;
  formSuccess.hidden = true;
}

function showSuccess(msg) {
  formSuccess.textContent = msg;
  formSuccess.hidden = false;
  formError.hidden = true;
}

/* ============================================
   Error message translation
   ============================================ */
function describeAuthError(err) {
  const code = err && err.code;
  if (code === 'auth/invalid-email') return 'รูปแบบอีเมลไม่ถูกต้อง';
  if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
    return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
  }
  if (code === 'auth/too-many-requests') return 'ลองผิดหลายครั้งเกินไป กรุณารอสักครู่';
  if (code === 'auth/email-already-in-use') return 'อีเมลนี้มีบัญชีอยู่แล้ว ลองเข้าสู่ระบบแทน';
  if (code === 'auth/weak-password') return 'รหัสผ่านสั้นเกินไป ต้องมีอย่างน้อย 6 ตัวอักษร';
  if (code === 'auth/network-request-failed') return 'เชื่อมต่ออินเทอร์เน็ตไม่ได้ ลองใหม่อีกครั้ง';
  return (err && err.message) ? err.message : 'ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง';
}

/* ============================================
   Login submit
   ============================================ */
loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  clearMessages();
  loginSubmit.disabled = true;
  loginSubmit.textContent = 'กำลังเข้าสู่ระบบ...';

  fbLogin(loginEmail.value.trim(), loginPassword.value)
    .then(() => {
      // onAuthChange listener above will redirect to index.html
    })
    .catch((err) => {
      showError(describeAuthError(err));
    })
    .finally(() => {
      loginSubmit.disabled = false;
      loginSubmit.textContent = 'เข้าสู่ระบบ';
    });
});

/* ============================================
   Register submit
   ============================================ */
registerForm.addEventListener('submit', (e) => {
  e.preventDefault();
  clearMessages();

  if (registerPassword.value !== registerPasswordConfirm.value) {
    showError('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
    return;
  }
  if (registerPassword.value.length < 6) {
    showError('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
    return;
  }

  registerSubmit.disabled = true;
  registerSubmit.textContent = 'กำลังสร้างบัญชี...';

  fbRegister(registerEmail.value.trim(), registerPassword.value)
    .then(() => {
      // onAuthChange listener above will redirect to index.html
    })
    .catch((err) => {
      showError(describeAuthError(err));
    })
    .finally(() => {
      registerSubmit.disabled = false;
      registerSubmit.textContent = 'สร้างบัญชี';
    });
});
