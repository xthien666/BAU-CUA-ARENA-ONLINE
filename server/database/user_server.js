import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: [true, 'Vui lòng nhập tên đăng nhập'],
        unique: true,
        trim: true,
        minlength: [3, 'Tên đăng nhập phải có ít nhất 3 ký tự'],
        validate: {
            validator: function(v) {
                // Chỉ cho phép chữ cái và số, cấm tuyệt đối \ / * ? " < > | và khoảng trắng
                return /^[a-zA-Z0-9_]+$/.test(v);
            },
            message: 'Tên đăng nhập viết liền, không dấu và không chứa ký tự đặc biệt!'
        }
    },
    email: {
        type: String,
        required: [true, 'Vui lòng nhập email'],
        unique: true,
        trim: true,
        lowercase: true,
    },
    password: {
        type: String,
        required: [true, 'Vui lòng nhập mật khẩu'],
        validate: {
            validator: function(v) {
                // Biểu thức chính quy: Ít nhất 1 chữ cái, 1 chữ số, 1 ký tự đặc biệt, dài 8-16
                return /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,16}$/.test(v);
            },
            message: 'Mật khẩu phải từ 8-16 ký tự, bao gồm cả chữ cái, chữ số và ký tự đặc biệt (@$!%*#?&)'
        }
    },
    balance: {
        type: Number,
        default: 50000 // Tặng 50k xu ảo khi tạo tài khoản mới
    },
    referralCode: {
        type: String,
        default: ''
    },
    inviteCode: {
        type: String,
        unique: true,
        default: () => randomBytes(5).toString('base64url').toUpperCase()
    },
    referredBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    termsAcceptedAt: {
        type: Date,
        required: [true, 'Bạn cần đồng ý với điều khoản sử dụng']
    }
}, { timestamps: true });

// Middleware tự động mã hóa mật khẩu trước khi lưu vào database
userSchema.pre('save', async function() {
    if (!this.isModified('password')) return;
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
});

// Hàm kiểm tra mật khẩu khi đăng nhập
userSchema.methods.matchPassword = async function(enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

export default mongoose.model('User', userSchema);