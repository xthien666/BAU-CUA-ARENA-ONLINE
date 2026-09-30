document.addEventListener('DOMContentLoaded', () => {
    const authScreen = document.getElementById('auth-screen');
    const mainLobbyScreen = document.getElementById('main-lobby-screen');
    const loginBox = document.getElementById('login-box');
    const registerBox = document.getElementById('register-box');

    // --- 1. ĐIỀU HƯỚNG GIAO DIỆN FORM ---
    document.getElementById('btn-show-register').addEventListener('click', () => {
        loginBox.hidden = true; registerBox.hidden = false;
    });

    document.getElementById('btn-show-login').addEventListener('click', () => {
        registerBox.hidden = true; loginBox.hidden = false;
    });

    document.getElementById('btn-forgot-password').addEventListener('click', () => {
        document.getElementById('forgot-password-dialog')?.showModal();
    });

    document.getElementById('forgot-password-cancel').addEventListener('click', () => {
        document.getElementById('forgot-password-dialog')?.close();
    });

    document.getElementById('forgot-password-form').addEventListener('submit', event => {
        event.preventDefault();
        const message = document.getElementById('forgot-password-message');
        message.textContent = 'Yêu cầu đã được ghi nhận. Chức năng gửi email khôi phục cần cấu hình SMTP.';
        message.hidden = false;
    });

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    document.querySelectorAll('.ios-only').forEach(button => { button.hidden = !isIOS; });
    document.querySelectorAll('.social-login-button').forEach(button => {
        button.addEventListener('click', () => {
            const provider = button.getAttribute('aria-label')?.replace('Đăng nhập bằng ', '') || 'mạng xã hội';
            const error = document.getElementById('login-error');
            error.textContent = `${provider} OAuth chưa được cấu hình.`;
            error.hidden = false;
        });
    });

    document.getElementById('btn-back-to-login-success').addEventListener('click', () => {
        document.getElementById('reg-success-wrap').hidden = true;
        document.getElementById('btn-register-submit').hidden = false;
        registerBox.hidden = true; loginBox.hidden = false;
    });

    // --- 2. XỬ LÝ ĐĂNG KÝ TÀI KHOẢN ---
    document.getElementById('register-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('reg-username').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const password = document.getElementById('reg-password').value;
        const confirm = document.getElementById('reg-confirm').value;
        const referralCode = document.getElementById('reg-referral').value.trim();
        const termsAccepted = document.getElementById('reg-terms').checked;
        const errorText = document.getElementById('reg-error');

        if (!/^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,16}$/.test(password)) {
            errorText.textContent = 'Mật khẩu phải dài 8-16 ký tự, gồm chữ cái, chữ số và ký tự đặc biệt.';
            errorText.hidden = false;
            return;
        }
        if (password !== confirm) {
            errorText.textContent = "Mật khẩu xác nhận không khớp!";
            errorText.hidden = false;
            return;
        }

        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, email, password, referralCode, termsAccepted })
            });
            const data = await res.json();
            
            if (!res.ok) throw new Error(data.error || 'Lỗi đăng ký');
            
            errorText.hidden = true;
            document.getElementById('reg-success-wrap').hidden = false;
            document.getElementById('btn-register-submit').hidden = true;
        } catch (err) {
            errorText.textContent = err.message;
            errorText.hidden = false;
        }
    });

    // --- 3. XỬ LÝ ĐĂNG NHẬP ---
    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        const errorText = document.getElementById('login-error');

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            
            if (!res.ok) throw new Error(data.error || 'Sai thông tin đăng nhập');
            
            // Lưu chứng chỉ vào trình duyệt
            localStorage.setItem('baucua_token', data.token);
            localStorage.setItem('baucua_user', JSON.stringify(data.user));
            
            errorText.hidden = true;
            window.checkAuthAndLoadLobby(); // Chuyển sang Sảnh
        } catch (err) {
            errorText.textContent = err.message;
            errorText.hidden = false;
        }
    });

    // --- 4. ĐĂNG XUẤT ---
    document.getElementById('btn-logout').addEventListener('click', () => {
        localStorage.removeItem('baucua_token');
        localStorage.removeItem('baucua_user');
        location.reload(); // Tải lại toàn bộ trang
    });

    // --- 5. LOGIC HIỂN THỊ SẢNH CHỜ ---
    window.checkAuthAndLoadLobby = function() {
        const token = localStorage.getItem('baucua_token');
        const userStr = localStorage.getItem('baucua_user');
        
        if (token && userStr) {
            const user = JSON.parse(userStr);
            authScreen.hidden = true;
            mainLobbyScreen.hidden = false;
            document.body.classList.add('scroll-mode'); // Bật cuộn chuột
            
            document.getElementById('lobby-username').textContent = user.username;
            document.getElementById('lobby-balance').textContent = Number(user.balance).toLocaleString('vi-VN');
            
            loadRooms(); // Tải danh sách bàn
        } else {
            authScreen.hidden = false;
            mainLobbyScreen.hidden = true;
            document.body.classList.add('scroll-mode');
        }
    };

    // --- 6. RENDER DANH SÁCH BÀN CHƠI ---
    async function loadRooms() {
        try {
            const token = localStorage.getItem('baucua_token');
            const res = await fetch('/api/rooms', { headers: { Authorization: `Bearer ${token}` } });
            const data = await res.json();
            const container = document.getElementById('active-rooms-list');
            
            if (data.rooms.length === 0) {
                container.innerHTML = '<p class="mode-desc" style="text-align: center; width: 100%;">Hiện chưa có bàn nào đang hoạt động. Hãy tạo bàn mới!</p>';
                return;
            }

            container.innerHTML = data.rooms.map(room => `
                <div class="room-item">
                    <div class="room-item-info">
                        <strong>Bàn: ${room.code}</strong>
                        <span>${room.playersCount}/20 Người chơi · Tối thiểu ${Number(room.minimumBalance || 0).toLocaleString('vi-VN')} xu</span>
                    </div>
                    <button class="btn-gold-secondary btn-sm" onclick="window.joinGame('${room.code}')">Vào chơi</button>
                </div>
            `).join('');
            
        } catch (err) {
            console.error("Lỗi tải danh sách phòng:", err);
        }
    }

    document.getElementById('btn-refresh-rooms').addEventListener('click', loadRooms);

    // --- 7. KẾT NỐI VỚI LUỒNG GAME CỐT LÕI (MAIN.JS) ---
    document.getElementById('btn-create-room').addEventListener('click', () => {
        document.getElementById('create-room-dialog')?.showModal();
    });

    document.getElementById('create-room-cancel').addEventListener('click', () => {
        document.getElementById('create-room-dialog')?.close();
    });

    document.getElementById('create-room-confirm').addEventListener('click', () => {
        document.getElementById('create-room-dialog')?.close();
        if (window.triggerGameAction) window.triggerGameAction('create', '');
    });

    document.getElementById('btn-join-room').addEventListener('click', () => {
        const code = document.getElementById('join-room-code').value;
        if (!code) return alert("Vui lòng nhập mã phòng!");
        if (window.triggerGameAction) window.triggerGameAction('join', code);
    });

    document.getElementById('btn-quick-play').addEventListener('click', async () => {
        try {
            const token = localStorage.getItem('baucua_token');
            const res = await fetch('/api/rooms', { headers: { Authorization: `Bearer ${token}` } });
            const data = await res.json();
            if (data.rooms.length > 0) window.triggerGameAction('join', data.rooms[0].code);
            else window.triggerGameAction('create', ''); // Không có phòng thì tự tạo
        } catch(e) {
            window.triggerGameAction('create', '');
        }
    });

    window.joinGame = function(code) {
        if (window.triggerGameAction) window.triggerGameAction('join', code);
    };

    // Khởi chạy kiểm tra khi vừa vào web
    window.checkAuthAndLoadLobby();
});