// src/js/auth.js

// Các Element Form
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const switchToRegisterBtn = document.getElementById('switch-to-register');
const switchToLoginBtn = document.getElementById('switch-to-login');

// Các Element Màn hình
const authScreen = document.getElementById('auth-screen');
const mainLobbyScreen = document.getElementById('main-lobby-screen');

// Header hiển thị thông tin
const lobbyUsername = document.getElementById('lobby-username');
const lobbyCoins = document.getElementById('lobby-coins');

// --- 1. CHUYỂN ĐỔI GIỮA FORM ĐĂNG NHẬP & ĐĂNG KÝ ---
switchToRegisterBtn.addEventListener('click', () => {
    loginForm.setAttribute('hidden', '');
    loginForm.style.display = 'none';

    registerForm.removeAttribute('hidden');
    registerForm.style.display = 'block';
});
switchToLoginBtn.addEventListener('click', () => { 
    registerForm.setAttribute('hidden', ''); 
    registerForm.style.display = 'none'; 
    loginForm.removeAttribute('hidden'); 
    loginForm.style.display = 'block'; 
});

// --- 2. HÀM KIỂM TRA TÊN ĐĂNG NHẬP & MẬT KHẨU ---
const isValidUsername = (username) => {
    // Đảm bảo cụm Regex này giống hệt bên auth_sv_2.js
    const forbiddenChars = /[<>"'\s]/;
    return username && username.length >= 3 && username.length <= 24 && !forbiddenChars.test(username);
};

const isValidPassword = (password) => {
    const forbiddenChars = /[\s]/;
    return password && password.length >= 6 && password.length <= 18 && !forbiddenChars.test(password);
};

// --- 3. XỬ LÝ ĐĂNG KÝ ---
registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('reg-username').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    const confirmPassword = document.getElementById('reg-password-confirm').value;
    const referralCode = document.getElementById('reg-referral').value;

    if (password !== confirmPassword) {
        return alert('Mật khẩu nhập lại không khớp!');
    }
    if (!isValidUsername(username)) {
        return alert('Tên đăng nhập không hợp lệ. (Không chứa ký tự cấm, dài 3-24 ký tự)');
    }
    if (!isValidPassword(password)) {
        return alert('Mật khẩu không hợp lệ. (Từ 6-18 ký tự, viết liền)');
    }

    try {
        const response = await fetch('/api/auth_sv/register', { // Chú ý: sửa endpoint cho khớp với cấu hình app_3.js
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password, referralCode })
        });
        const data = await response.json();

        if (response.ok) {
            alert('Đăng ký thành công! Vui lòng đăng nhập.');
            switchToLoginBtn.click();
        } else {
            alert(data.error || 'Đăng ký thất bại');
        }
    } catch (err) {
        alert('Lỗi kết nối đến máy chủ.');
    }
});

// --- 4. XỬ LÝ ĐĂNG NHẬP THỦ CÔNG ---
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await response.json();

        if (response.ok) {
            handleLoginSuccess(data);
        } else {
            alert(data.error || 'Đăng nhập thất bại');
        }
    } catch (err) {
        alert('Lỗi kết nối đến máy chủ.');
    }
});

// --- 5. XỬ LÝ ĐĂNG NHẬP BẰNG GOOGLE ---
window.handleGoogleLogin = async (response) => {
    const idToken = response.credential;

    try {
        const res = await fetch('/api/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken })
        });
        const data = await res.json();

        if (res.ok) {
            handleLoginSuccess(data);
        } else {
            alert(data.error || 'Đăng nhập Google thất bại');
        }
    } catch (err) {
        alert('Lỗi kết nối xác thực Google.');
    }
};

// --- HÀM CHUNG: KHI ĐĂNG NHẬP THÀNH CÔNG ---
function handleLoginSuccess(data) {
    localStorage.setItem('auth_token', data.token);
    localStorage.setItem('username', data.username);

    lobbyUsername.textContent = data.username;
    lobbyCoins.textContent = data.coins || 1000;

    authScreen.hidden = true;
    mainLobbyScreen.hidden = false;
}