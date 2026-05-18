const API_BASE = 'http://localhost:5050/api';

const $ = (id) => document.getElementById(id);
let authMode = 'register';

function setAuthMessage(message, isError = false) {
  const el = $('authMessage');
  el.textContent = message;
  el.hidden = !message;
  el.style.color = isError ? '#c2410c' : '#667085';
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || error.detail || 'Request failed');
  }

  return response.json();
}

function saveSession(token, user) {
  localStorage.setItem('mrmsToken', token);
  localStorage.setItem('mrmsUser', JSON.stringify(user));
}

function setAuthMode(mode) {
  authMode = mode;
  const isRegister = mode === 'register';
  $('publicRegisterForm').hidden = !isRegister;
  $('loginForm').hidden = isRegister;
  $('authTitle').textContent = isRegister ? 'Create account' : 'Welcome back';
  $('authSubtitle').textContent = isRegister
    ? 'Register as a patient to access your medical history.'
    : 'Login to continue to your medical records workspace.';
  $('authSwitchText').textContent = isRegister ? 'Already have an account?' : "Don't have an account?";
  $('authSwitchBtn').textContent = isRegister ? 'Login' : 'Register';
  setAuthMessage('');
}

async function login(event) {
  event.preventDefault();
  const data = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: $('loginEmail').value.trim(),
      password: $('loginPassword').value,
    }),
  });
  saveSession(data.token, data.user);
  window.location.href = 'dashboard.html';
}

async function publicRegister(event) {
  event.preventDefault();
  const data = await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      full_name: $('publicName').value.trim(),
      email: $('publicEmail').value.trim(),
      password: $('publicPassword').value,
      date_of_birth: $('publicDob').value,
      gender: $('publicGender').value,
      phone: $('publicPhone').value.trim(),
    }),
  });
  saveSession(data.token, data.user);
  window.location.href = 'dashboard.html';
}

if (localStorage.getItem('mrmsToken') && localStorage.getItem('mrmsUser')) {
  window.location.href = 'dashboard.html';
}

$('loginForm').addEventListener('submit', (event) => login(event).catch((error) => setAuthMessage(error.message, true)));
$('publicRegisterForm').addEventListener('submit', (event) => publicRegister(event).catch((error) => setAuthMessage(error.message, true)));
$('authSwitchBtn').addEventListener('click', () => setAuthMode(authMode === 'register' ? 'login' : 'register'));

setAuthMode('register');
