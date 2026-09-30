import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { User } from '../db.js'; // Import model User vừa tạo

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'bau-cua-arena-secret-key-super-safe'; // Key để tạo token
const GOOGLE_CLIENT_ID = 'ĐIỀN_CLIENT_ID_GOOGLE_CỦA_BẠN_VÀO_ĐÂY'; // Bạn sẽ cần tạo ID này trên Google Cloud Console
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Hàm kiểm tra Tên đăng nhập 
const isValidUsername = (username) => {
    const forbiddenChars = /[<>"'\s]/;
    return username && username.length >= 3 && username.length <= 24 && !forbiddenChars.test(username);
};

// Hàm kiểm tra Mật khẩu (Nới lỏng, chỉ cấm khoảng trắng)
const isValidPassword = (password) => {
    const forbiddenChars = /[\s]/;
    return password && password.length >= 6 && password.length <= 18 && !forbiddenChars.test(password);
};

// 1. API Đăng Ký Thủ Công (Email + Password)
router.post('/register', async (req, res) => {
    try {
        const { username, email, password, referralCode } = req.body;

        // Kiểm tra tên đăng nhập
        if (!isValidUsername(username)) {
            return res.status(400).json({ error: 'Tên đăng nhập không hợp lệ (không được chứa khoảng trắng hoặc ký tự cấm).' });
        }

        // Kiểm tra mật khẩu
        if (!isValidPassword(password)) {
            return res.status(400).json({ error: 'Mật khẩu phải từ 6-18 ký tự và không được chứa khoảng trắng.' });
        }

        // Kiểm tra email đã tồn tại chưa
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: 'Email này đã tồn tại.' });
        }

        // Mã hóa mật khẩu
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        // Lưu user vào DB
        const newUser = new User({
            username,
            email,
            password_hash,
            referralCode
        });
        await newUser.save();

        res.status(201).json({ message: 'Đăng ký thành công!' });
    } catch (error) {
        console.error('Lỗi đăng ký:', error);
        res.status(500).json({ error: 'Lỗi server khi đăng ký.' });
    }
});

// 2. API Đăng Nhập Thủ Công
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Tìm user bằng email
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ error: 'Tài khoản không tồn tại.' });
        }

        // Kiểm tra pass
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(400).json({ error: 'Mật khẩu không chính xác.' });
        }

        // Tạo JWT Token
        const token = jwt.sign({ userId: user._id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

        res.json({ message: 'Đăng nhập thành công', token, username: user.username, coins: user.coins });
    } catch (error) {
        console.error('Lỗi đăng nhập:', error);
        res.status(500).json({ error: 'Lỗi server khi đăng nhập.' });
    }
});

// 3. API Đăng nhập bằng Google
router.post('/google', async (req, res) => {
    try {
        const { idToken } = req.body; // Client gửi ID token của Google lên

        // Verify token với Google
        const ticket = await googleClient.verifyIdToken({
            idToken: idToken,
            audience: GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        const { email, name, sub: googleId } = payload; // 'sub' là Google User ID

        // Tìm xem user đã đăng nhập bao giờ chưa
        let user = await User.findOne({ email });

        if (!user) {
            // Lần đầu đăng nhập -> Tạo tài khoản mới tự động
            user = new User({
                username: name,
                email: email,
                googleId: googleId
            });
            await user.save();
        } else if (!user.googleId) {
            // Đã có tài khoản bằng email này, nhưng chưa liên kết Google
            user.googleId = googleId;
            await user.save();
        }

        // Cấp JWT Token của hệ thống game
        const token = jwt.sign({ userId: user._id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

        res.json({ message: 'Đăng nhập Google thành công', token, username: user.username, coins: user.coins });
    } catch (error) {
        console.error('Lỗi Google Auth:', error);
        res.status(401).json({ error: 'Xác thực Google thất bại.' });
    }
});

export default router;
