import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

// 1. Hàm kết nối Database
export const connectDB = async () => {
  try {
    // Nếu bạn chưa có link MongoDB Atlas, tạm thời dùng MongoDB cài ở máy (localhost). 
    // Trong tương lai khi đưa lên mạng, bạn sẽ dùng biến môi trường MONGODB_URI.
    const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/baucua_arena';
    await mongoose.connect(uri);
    console.log('✅ Đã kết nối thành công tới Database (MongoDB)');
  } catch (error) {
    console.error('❌ Lỗi kết nối Database:', error);
    process.exit(1);
  }
};

// 2. Định nghĩa cấu trúc Tài khoản (User Schema)
const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    trim: true,
    minlength: 6,
    maxlength: 20
  },
  email: {
    type: String,
    required: true,
    unique: true, // Không cho phép 2 tài khoản trùng email
    trim: true,
    lowercase: true
  },
  password_hash: {
    type: String,
    // Không bắt buộc nếu người dùng đăng nhập bằng Google
  },
  googleId: {
    type: String,
    // Lưu ID của Google nếu đăng nhập qua Google
  },
  coins: {
    type: Number,
    default: 1000 // Tặng 1000 xu cho tài khoản mới đăng ký
  },
  referralCode: {
    type: String, // Lưu mã giới thiệu nếu có
  }
}, { timestamps: true });

// 3. Hàm kiểm tra mật khẩu
userSchema.methods.comparePassword = async function(candidatePassword) {
  if (!this.password_hash) return false;
  return await bcrypt.compare(candidatePassword, this.password_hash);
};

export const User = mongoose.model('User', userSchema);