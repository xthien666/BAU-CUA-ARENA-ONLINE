import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../server/database/user_server.js';

const password = process.env.TEST_USER_PASSWORD || 'Test@1234';
const users = [
  { username: 'tester', email: 'tester@gmail.com' },
  { username: 'npc_lv1', email: 'npc_lv1@gmail.com' },
];

if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI chưa được cấu hình.');
await mongoose.connect(process.env.MONGODB_URI);

try {
  for (const user of users) {
    const existing = await User.findOne({ email: user.email });
    if (existing) {
      console.log(`Đã tồn tại: ${user.email}`);
      continue;
    }
    await User.create({
      ...user,
      password,
      termsAcceptedAt: new Date(),
    });
    console.log(`Đã tạo: ${user.email}`);
  }
} finally {
  await mongoose.disconnect();
}
