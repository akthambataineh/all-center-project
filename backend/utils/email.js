
// utils/email.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

const sendRestaurantCredentials = async (email, username, password, restaurantName) => {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'بيانات الدخول لنظام إدارة المطعم',
    html: `
      <div dir="rtl" style="font-family: Arial, sans-serif;">
        <h2>مرحباً بك في نظام إدارة المطاعم</h2>
        <p>تم إنشاء حساب جديد لمطعم: <strong>${restaurantName}</strong></p>
        <h3>بيانات الدخول:</h3>
        <p><strong>اسم المستخدم:</strong> ${username}</p>
        <p><strong>كلمة المرور:</strong> ${password}</p>
        <p><strong>رابط الدخول:</strong> <a href="${process.env.FRONTEND_URL}/login">اضغط هنا للدخول</a></p>
        <br>
        <p>يرجى الحفاظ على هذه المعلومات آمنة وعدم مشاركتها مع أي شخص غير مخول.</p>
        <p>مع تحيات فريق إدارة المطاعم</p>
      </div>
    `
  };

  return transporter.sendMail(mailOptions);
};

const sendPartnerCredentials = async (email, username, password, partnerName) => {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'بيانات الدخول كشريك في نظام إدارة المطاعم',
    html: `
      <div dir="rtl" style="font-family: Arial, sans-serif;">
        <h2>مرحباً بك كشريك معنا</h2>
        <p>تم إنشاء حساب شريك جديد باسم: <strong>${partnerName}</strong></p>
        <h3>بيانات الدخول:</h3>
        <p><strong>اسم المستخدم:</strong> ${username}</p>
        <p><strong>كلمة المرور:</strong> ${password}</p>
        <p><strong>رابط الدخول:</strong> <a href="${process.env.FRONTEND_URL}/in">اضغط هنا للدخول</a></p>
        <br>
        <p>يمكنك الآن البدء في إضافة المطاعم وإدارتها حسب الصلاحيات الممنوحة لك.</p>
        <p>مع تحيات فريق إدارة المطاعم</p>
      </div>
    `
  };

  return transporter.sendMail(mailOptions);
};

module.exports = {
  sendRestaurantCredentials,
  sendPartnerCredentials
};
