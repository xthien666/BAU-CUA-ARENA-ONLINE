import jwt from 'jsonwebtoken';
import User from './database/user_server.js';

const jwtSecret = () => {
    if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET chưa được cấu hình.');
    return process.env.JWT_SECRET;
};

export const verifyAccessToken = async (token) => {
    if (typeof token !== 'string' || token.length === 0) return null;
    try {
        const decoded = jwt.verify(token, jwtSecret());
        return await User.findById(decoded.id);
    } catch {
        return null;
    }
};

// Hàm phụ trợ: Đọc dữ liệu JSON gửi lên từ Client thông qua Node HTTP thuần
const parseJSON = (req) => {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try { resolve(body ? JSON.parse(body) : {}); }
            catch (e) { reject(e); }
        });
    });
};

// Hàm tạo Token 
const generateToken = (id) => {
    return jwt.sign({ id }, jwtSecret(), { expiresIn: '30d' });
};

// API 1: Xử lý Đăng ký
export const handleRegister = async (req, res, sendJson) => {
    try {
        const { username, email, password, referralCode, termsAccepted } = await parseJSON(req);
        if (termsAccepted !== true) return sendJson(res, 400, { error: 'Bạn cần đồng ý với điều khoản sử dụng.' });
        const normalizedReferral = typeof referralCode === 'string' ? referralCode.trim().toUpperCase() : '';
        const referrer = normalizedReferral ? await User.findOne({ inviteCode: normalizedReferral }) : null;
        if (normalizedReferral && !referrer) return sendJson(res, 400, { error: 'Mã giới thiệu không hợp lệ.' });

        // Kiểm tra xem email hoặc tên đăng nhập đã tồn tại chưa
        const userExists = await User.findOne({ $or: [{ email }, { username }] });
        if (userExists) {
            if (userExists.email === email) return sendJson(res, 400, { error: 'Email đã được sử dụng!' });
            if (userExists.username === username) return sendJson(res, 400, { error: 'Tên đăng nhập đã tồn tại!' });
        }

        // Tạo tài khoản mới (Mật khẩu tự động được mã hóa nhờ logic trong model User)
        const user = await User.create({
            username, email, password, referralCode: normalizedReferral,
            referredBy: referrer?._id ?? null, termsAcceptedAt: new Date()
        });

        sendJson(res, 201, {
            message: 'Tạo tài khoản thành công!',
            user: { id: user._id, username: user.username, email: user.email, balance: user.balance, inviteCode: user.inviteCode }
        });
    } catch (error) {
        // Bắt các lỗi vi phạm quy tắc (Tên có ký tự đặc biệt, mật khẩu ngắn...) từ MongoDB
        const message = error.errors ? Object.values(error.errors).map(val => val.message).join(', ') : error.message;
        sendJson(res, 400, { error: message });
    }
};

// API 2: Xử lý Đăng nhập
export const handleLogin = async (req, res, sendJson) => {
    try {
        const { email, password } = await parseJSON(req);

        // Tìm User theo email
        const user = await User.findOne({ email });
        
        // Kiểm tra mật khẩu
        if (user && (await user.matchPassword(password))) {
            sendJson(res, 200, {
                message: 'Đăng nhập thành công!',
                user: { id: user._id, username: user.username, email: user.email, balance: user.balance },
                token: generateToken(user._id)
            });
        } else {
            sendJson(res, 401, { error: 'Email hoặc mật khẩu không chính xác!' });
        }
    } catch (error) {
        sendJson(res, 500, { error: 'Lỗi máy chủ trong quá trình đăng nhập.' });
    }
};