// sajed.js
const mongoose = require('mongoose');
const User = require('./models/User'); // غيّر المسار حسب مكان ملف userSchema.js
require('dotenv').config();

// اتصال بقاعدة البيانات
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ متصل بقاعدة البيانات'))
.catch(err => console.error('❌ خطأ في الاتصال:', err));

// إضافة مستخدم جديد
async function createUser() {
  try {
    const newUser = new User({
      email: 'omer@gmail.com',
      password: '12345678', // يتم تشفيره تلقائياً بفضل pre('save')
      role: 'admin', // ممكن: admin / restaurant / partner
      permissions: {
        canAddRestaurant: true,
        canEditMenu: true,
        canViewOrders: true,
        canManageTables: true,
        canViewReports: true
      }
    });

    await newUser.save();
    console.log('✅ تم إنشاء المستخدم بنجاح:', newUser.email);
  } catch (err) {
    console.error('❌ خطأ أثناء إنشاء المستخدم:', err.message);
  } finally {
    mongoose.connection.close();
  }
}

createUser();
