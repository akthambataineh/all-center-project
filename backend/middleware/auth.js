const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authenticate = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ message: 'رمز المصادقة غير موجود' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).populate('restaurantId');
    
    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'المستخدم غير صالح أو محظور' });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ message: 'رمز المصادقة غير صالح' });
  }
};

const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'ليس لديك صلاحية للوصول لهذا المحتوى' });
    }
    next();
  };
};

const checkPermission = (permission) => {
  return (req, res, next) => {
    if (req.user.role === 'admin') {
      return next();
    }
    
    if (req.user.permissions && req.user.permissions[permission]) {
      return next();
    }
    
    if (req.user.restaurantId && req.user.restaurantId.permissions && req.user.restaurantId.permissions[permission]) {
      return next();
    }
    
    return res.status(403).json({ message: 'ليس لديك صلاحية لتنفيذ هذا الإجراء' });
  };
};

module.exports = {
  authenticate,
  authorizeRoles,
  checkPermission
};