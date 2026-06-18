const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const Partner = require('../models/Partner');
const Order = require('../models/Order');
const { authenticate, authorizeRoles, checkPermission} = require('../middleware/auth');
const { uploadImage } = require('../utils/cloudinary');
const { sendRestaurantCredentials, sendPartnerCredentials } = require('../utils/email');

const multer = require('multer');
const path = require('path');

// إعداد التخزين
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/'); // مجلد حفظ الملفات
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname); // تسمية فريدة للملف
  }
});

// تعريف upload
const upload = multer({ storage: storage });
const router = express.Router();

// Admin Login
router.post('/login', [
  body('email').isEmail().withMessage('يجب إدخال إيميل صحيح'),
  body('password').isLength({ min: 6 }).withMessage('كلمة المرور يجب أن تكون 6 أحرف على الأقل')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;
    const user = await User.findOne({ email, role: 'admin' });

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'بيانات الدخول غير صحيحة' });
    }

    if (!user.isActive) {
      return res.status(401).json({ message: 'الحساب محظور' });
    }

    const token = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get Restaurant Orders
router.get('/orders', authenticate, authorizeRoles('restaurant'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const status = req.query.status;
    const skip = (page - 1) * limit;

    let query = { restaurant: req.user.restaurantId._id };
    if (status) {
      query.status = status;
    }

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Order.countDocuments(query);

    res.json({
      orders,
      pagination: {
        page,
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Update Order Status
router.patch('/orders/:orderId/status', authenticate, authorizeRoles('restaurant'), async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;

    const order = await Order.findOne({
      _id: orderId,
      restaurant: req.user.restaurantId._id
    });

    if (!order) {
      return res.status(404).json({ message: 'الطلب غير موجود' });
    }

    order.status = status;
    await order.save();

    res.json({
      message: 'تم تحديث حالة الطلب بنجاح',
      order
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get Tables
router.get('/tables', authenticate, authorizeRoles('restaurant'), async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.user.restaurantId._id);
    
    if (!restaurant) {
      return res.status(404).json({ message: 'المطعم غير موجود' });
    }

    if (!restaurant.hasTables) {
      return res.json({ message: 'هذا المطعم لا يحتوي على طاولات', tables: [] });
    }

    res.json(restaurant.tables);
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Update Table Reservation
router.patch('/tables/:tableNumber', authenticate, authorizeRoles('restaurant'), checkPermission('canManageTables'), async (req, res) => {
  try {
    const { tableNumber } = req.params;
    const { isReserved, customerName, customerPhone, reservationTime } = req.body;

    const restaurant = await Restaurant.findById(req.user.restaurantId._id);
    
    if (!restaurant) {
      return res.status(404).json({ message: 'المطعم غير موجود' });
    }

    const table = restaurant.tables.find(t => t.number == tableNumber);
    if (!table) {
      return res.status(404).json({ message: 'الطاولة غير موجودة' });
    }

    table.isReserved = isReserved;
    if (isReserved) {
      table.customerName = customerName;
      table.customerPhone = customerPhone;
      table.reservationTime = reservationTime || new Date();
    } else {
      table.customerName = undefined;
      table.customerPhone = undefined;
      table.reservationTime = undefined;
    }

    await restaurant.save();

    res.json({
      message: 'تم تحديث حجز الطاولة بنجاح',
      table
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get Sales Reports
router.get('/reports/sales', authenticate, authorizeRoles('restaurant'), checkPermission('canViewReports'), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter = {
        createdAt: {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        }
      };
    }

    const salesData = await Order.aggregate([
      {
        $match: {
          restaurant: req.user.restaurantId._id,
          status: { $ne: 'cancelled' },
          ...dateFilter
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: '$totalAmount' },
          date: { $first: '$createdAt' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    const totalSales = await Order.aggregate([
      {
        $match: {
          restaurant: req.user.restaurantId._id,
          status: { $ne: 'cancelled' },
          ...dateFilter
        }
      },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: '$totalAmount' }
        }
      }
    ]);

    res.json({
      dailySales: salesData,
      totalSales: totalSales[0] || { totalOrders: 0, totalRevenue: 0 }
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});






//extra coode








router.get('/dashboard', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const totalRestaurants = await Restaurant.countDocuments();
    const activeRestaurants = await Restaurant.countDocuments({ isActive: true });
    const totalOrders = await Order.countDocuments();
    const totalPartners = await Partner.countDocuments();
    
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    
    const todayOrders = await Order.countDocuments({
      createdAt: { $gte: todayStart, $lte: todayEnd }
    });

    const totalRevenue = await Order.aggregate([
      { $match: { status: { $ne: 'cancelled' } } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);

    res.json({
      totalRestaurants,
      activeRestaurants,
      totalOrders,
      totalPartners,
      todayOrders,
      totalRevenue: totalRevenue[0]?.total || 0
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Add Restaurant
router.post('/restaurants', authenticate, authorizeRoles('admin'), async (req, res) => {  
  try {
    const {
      name,
      description,
      menu,
      hasTables,
      totalTables,
      contact,
      permissions,
      email,
      password
    } = req.body;

    // Create restaurant
    const restaurant = new Restaurant({
      name,
      description,
      menu: menu || [],
      hasTables: hasTables || false,
      totalTables: totalTables || 0,
      contact,
      permissions,
      createdBy: req.user._id
    });

    if (hasTables && totalTables > 0) {
      restaurant.tables = Array.from({ length: totalTables }, (_, i) => ({
        number: i + 1,
        capacity: 4,
        isReserved: false
      }));
    }

    await restaurant.save();

    // Create user account for restaurant
    const user = new User({
      email,
      password,
      role: 'restaurant',
      restaurantId: restaurant._id,
      permissions
    });

    await user.save();

    // Send credentials email
    try {
      await sendRestaurantCredentials(email, email, password, name);
    } catch (emailError) {
      console.log('فشل في إرسال الإيميل:', emailError);
    }

    res.status(201).json({
      message: 'تم إضافة المطعم بنجاح',
      restaurant,
      user: { id: user._id, email: user.email }
    });
    console.log('Restaurant and user created successfully');
    
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get All Restaurants
router.get('/restaurants', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const restaurants = await Restaurant.find()
      .populate('createdBy', 'email')
      .sort({ createdAt: -1 });

    res.json(restaurants);
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// // Update Restaurant Status
// router.patch('/restaurants/:id/status', authenticate, authorizeRoles('admin'), async (req, res) => {
//   try {
//     const { isActive } = req.body;
//     const restaurant = await Restaurant.findByIdAndUpdate(
//       req.params.id,
//       { isActive },
//       { new: true }
//     );

//     if (!restaurant) {
//       return res.status(404).json({ message: 'المطعم غير موجود' });
//     }

//     // Update user status too
//     await User.updateOne(
//       { restaurantId: restaurant._id },
//       { isActive }
//     );

//     res.json({ message: 'تم تحديث حالة المطعم', restaurant });
//   } catch (error) {
//     res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
//   }
// });

// // Update Restaurant Permissions
// router.patch('/restaurants/:id/permissions', authenticate, authorizeRoles('admin'), async (req, res) => {
//   try {
//     const { permissions } = req.body;
//     const restaurant = await Restaurant.findByIdAndUpdate(
//       req.params.id,
//       { permissions },
//       { new: true }
//     );

//     if (!restaurant) {
//       return res.status(404).json({ message: 'المطعم غير موجود' });
//     }

//     // Update user permissions too
//     await User.updateOne(
//       { restaurantId: restaurant._id },
//       { permissions }
//     );

//     res.json({ message: 'تم تحديث صلاحيات المطعم', restaurant });
//   } catch (error) {
//     res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
//   }
// });

// Get All Orders
// router.get('/orders', authenticate, authorizeRoles('admin'), async (req, res) => {
//   try {
//     const page = parseInt(req.query.page) || 1;
//     const limit = parseInt(req.query.limit) || 20;
//     const skip = (page - 1) * limit;

//     const orders = await Order.find()
//       .populate('restaurant', 'name')
//       .sort({ createdAt: -1 })
//       .skip(skip)
//       .limit(limit);

//     const total = await Order.countDocuments();

//     res.json({
//       orders,
//       pagination: {
//         page,
//         pages: Math.ceil(total / limit),
//         total
//       }
//     });
//   } catch (error) {
//     res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
//   }
// });

// Add Partner
router.post('/partners', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const { name, email, password, phone, permissions } = req.body;

    // Create user account for partner
    const user = new User({
      email,
      password,
      role: 'partner',
      permissions
    });

    await user.save();

    // Create partner profile
    const partner = new Partner({
      userId: user._id,
      name,
      phone,
      permissions
    });

    await partner.save();

    // Send credentials email
    try {
      await sendPartnerCredentials(email, email, password, name);
    } catch (emailError) {
      console.log('فشل في إرسال الإيميل:', emailError);
    }

    res.status(201).json({
      message: 'تم إضافة الشريك بنجاح',
      partner,
      user: { id: user._id, email: user.email }
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get All Partners
router.get('/partners', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const partners = await Partner.find()
      .populate('userId', 'email isActive')
      .populate('restaurantsAdded', 'name')
      .sort({ createdAt: -1 });

    res.json(partners);
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get Single Restaurant Details
router.get('/restaurants/:id', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.params.id)
      .populate('createdBy', 'email');
    
    if (!restaurant) {
      return res.status(404).json({ message: 'المطعم غير موجود' });
    }

    res.json(restaurant);
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Update Restaurant Details
router.put('/restaurants/:id', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const {
      name,
      description,
      contact,
      hasTables,
      totalTables,
      permissions
    } = req.body;

    const restaurant = await Restaurant.findByIdAndUpdate(
      req.params.id,
      {
        name,
        description,
        contact,
        hasTables,
        totalTables,
        permissions
      },
      { new: true }
    );

    if (!restaurant) {
      return res.status(404).json({ message: 'المطعم غير موجود' });
    }

    // Update user permissions too
    await User.updateOne(
      { restaurantId: restaurant._id },
      { permissions }
    );

    res.json({ message: 'تم تحديث المطعم بنجاح', restaurant });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Delete Restaurant
router.delete('/restaurants/:id', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const restaurant = await Restaurant.findByIdAndDelete(req.params.id);
    
    if (!restaurant) {
      return res.status(404).json({ message: 'المطعم غير موجود' });
    }

    // Delete associated user
    await User.deleteOne({ restaurantId: req.params.id });

    res.json({ message: 'تم حذف المطعم بنجاح' });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Upload Restaurant Logo
router.post('/restaurants/:id/logo', authenticate, authorizeRoles('admin'), upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'لم يتم رفع أي ملف' });
    }

    const restaurant = await Restaurant.findByIdAndUpdate(
      req.params.id,
      { logo: req.file.path },
      { new: true }
    );

    if (!restaurant) {
      return res.status(404).json({ message: 'المطعم غير موجود' });
    }

    res.json({ message: 'تم رفع الشعار بنجاح', logoUrl: req.file.path });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Add Menu Item
router.post('/restaurants/:id/menu', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const { name, description, price, ingredients, category, isAvailable } = req.body;
    
    const restaurant = await Restaurant.findById(req.params.id);
    if (!restaurant) {
      return res.status(404).json({ message: 'المطعم غير موجود' });
    }

    const newMenuItem = {
      name,
      description,
      price,
      ingredients: ingredients || [],
      category,
      isAvailable: isAvailable !== undefined ? isAvailable : true
    };

    restaurant.menu.push(newMenuItem);
    await restaurant.save();

    res.json({ message: 'تم إضافة العنصر للقائمة', menuItem: newMenuItem });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Update Menu Item
router.put('/restaurants/:id/menu/:menuItemId', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const { name, description, price, ingredients, category, isAvailable } = req.body;
    
    const restaurant = await Restaurant.findById(req.params.id);
    if (!restaurant) {
      return res.status(404).json({ message: 'المطعم غير موجود' });
    }

    const menuItem = restaurant.menu.id(req.params.menuItemId);
    if (!menuItem) {
      return res.status(404).json({ message: 'عنصر القائمة غير موجود' });
    }

    menuItem.name = name || menuItem.name;
    menuItem.description = description || menuItem.description;
    menuItem.price = price || menuItem.price;
    menuItem.ingredients = ingredients || menuItem.ingredients;
    menuItem.category = category || menuItem.category;
    menuItem.isAvailable = isAvailable !== undefined ? isAvailable : menuItem.isAvailable;

    await restaurant.save();

    res.json({ message: 'تم تحديث عنصر القائمة', menuItem });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Delete Menu Item
router.delete('/restaurants/:id/menu/:menuItemId', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
      const { id, menuItemId } = req.params;

      const restaurant = await Restaurant.findByIdAndUpdate(
        id,
        { $pull: { menu: { _id: menuItemId } } }, // يسحب العنصر من المصفوفة
        { new: true }
      );

      if (!restaurant) {
        return res.status(404).json({ message: 'المطعم غير موجود' });
      }

      res.json({ message: 'تم حذف عنصر القائمة بنجاح', restaurant });
      console.log('Menu item deleted successfully');
    } catch (error) {
      res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
      console.log('Error deleting menu item:', error.message);
    }
});

// Get Restaurant Orders
router.get('/restaurants/:id/orders', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const orders = await Order.find({ restaurant: req.params.id })
      .sort({ createdAt: -1 })
      .populate('restaurant', 'name');

    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Update Order Status
router.patch('/orders/:id/status', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const { status } = req.body;
    
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ message: 'الطلب غير موجود' });
    }

    res.json({ message: 'تم تحديث حالة الطلب', order });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Delete Order
router.delete('/orders/:id', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.id);
    
    if (!order) {
      return res.status(404).json({ message: 'الطلب غير موجود' });
    }

    res.json({ message: 'تم حذف الطلب بنجاح' });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// إضافة هذه الـ routes إلى ملف الـ router الخاص بك

// Update Partner
router.put('/partners/:id', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const { name, phone, permissions, isActive } = req.body;
    const partnerId = req.params.id;

    // Update partner
    const partner = await Partner.findByIdAndUpdate(
      partnerId,
      { name, phone, permissions, isActive },
      { new: true }
    ).populate('userId', 'email isActive');

    if (!partner) {
      return res.status(404).json({ message: 'الشريك غير موجود' });
    }

    // Update user permissions
    await User.findByIdAndUpdate(
      partner.userId._id,
      { permissions, isActive }
    );

    res.json({
      message: 'تم تحديث بيانات الشريك بنجاح',
      partner
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Delete Partner
router.delete('/partners/:id', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const partnerId = req.params.id;

    const partner = await Partner.findById(partnerId);
    if (!partner) {
      return res.status(404).json({ message: 'الشريك غير موجود' });
    }

    // Delete user account
    await User.findByIdAndDelete(partner.userId);
    
    // Delete partner
    await Partner.findByIdAndDelete(partnerId);

    res.json({ message: 'تم حذف الشريك بنجاح' });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get Partner Details
router.get('/partners/:id', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const partner = await Partner.findById(req.params.id)
      .populate('userId', 'email isActive createdAt')
      .populate('restaurantsAdded', 'name address phone');

    if (!partner) {
      return res.status(404).json({ message: 'الشريك غير موجود' });
    }

    res.json(partner);
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Toggle Partner Status
router.patch('/partners/:id/toggle-status', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const partnerId = req.params.id;
    
    const partner = await Partner.findById(partnerId);
    if (!partner) {
      return res.status(404).json({ message: 'الشريك غير موجود' });
    }

    // Toggle status
    partner.isActive = !partner.isActive;
    await partner.save();

    // Update user status too
    await User.findByIdAndUpdate(partner.userId, { isActive: partner.isActive });

    res.json({
      message: `تم ${partner.isActive ? 'تفعيل' : 'إلغاء تفعيل'} الشريك بنجاح`,
      partner
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});
// Upload Image
router.post('/upload', authenticate, authorizeRoles('admin'), async (req, res) => {
  try {
    const { image, folder } = req.body;
    
    if (!image) {
      return res.status(400).json({ message: 'لم يتم تحميل صورة' });
    }

    const imageBuffer = Buffer.from(image.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    const result = await uploadImage(imageBuffer, folder);

    res.json({
      message: 'تم تحميل الصورة بنجاح',
      url: result.secure_url
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في تحميل الصورة', error: error.message });
  }
});

module.exports = router;

