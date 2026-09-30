import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

export const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI);
        console.log(`[MongoDB] Đã kết nối thành công: ${conn.connection.host}`);
    } catch (error) {
        console.error(`[MongoDB] Lỗi kết nối: ${error.message}`);
        process.exit(1);
    }
};