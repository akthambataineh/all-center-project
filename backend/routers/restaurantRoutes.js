const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const Order = require('../models/Order');
const { authenticate, authorizeRoles, checkPermission } = require('../middleware/auth');
const { uploadImage } = require('../utils/cloudinary');

const router = express.Router();

// Restaurant Login
router.post('/auth', [
  body('email').isEmail().withMessage('يجب إدخال إيميل صحيح'),
  body('password').isLength({ min: 6 }).withMessage('كلمة المرور يجب أن تكون 6 أحرف على الأقل')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;
    const user = await User.findOne({ email, role: 'restaurant' })
      .populate('restaurantId');

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'بيانات الدخول غير صحيحة' });
    }

    if (!user.isActive) {
      return res.status(401).json({ message: 'الحساب محظور' });
    }

    if (!user.restaurantId || !user.restaurantId.isActive) {
      return res.status(401).json({ message: 'المطعم غير نشط' });
    }

    const token = jwt.sign(
      { userId: user._id, role: user.role, restaurantId: user.restaurantId._id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        restaurant: user.restaurantId,
        permissions: user.permissions
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get Restaurant Profile
router.get('/profile', authenticate, authorizeRoles('restaurant'), async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.user.restaurantId._id);
    
    if (!restaurant) {
      return res.status(404).json({ message: 'المطعم غير موجود' });
    }

    res.json(restaurant);
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Update Restaurant Profile
router.put('/profile', authenticate, authorizeRoles('restaurant'), async (req, res) => {
  try {
    const { name, description, contact } = req.body;
    
    const restaurant = await Restaurant.findByIdAndUpdate(
      req.user.restaurantId._id,
      { name, description, contact },
      { new: true }
    );
    
    if (!restaurant) {
      return res.status(404).json({ message: 'المطعم غير موجود' });
    }

    res.json({
      message: 'تم تحديث بيانات المطعم بنجاح',
      restaurant
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get Restaurant Dashboard
router.get('/dashboard', authenticate, authorizeRoles('restaurant'), async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.user.restaurantId._id);
    
    if (!restaurant) {
      return res.status(404).json({ message: 'المطعم غير موجود' });
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const todayOrders = await Order.countDocuments({
      restaurant: restaurant._id,
      createdAt: { $gte: todayStart, $lte: todayEnd }
    });

    const todayRevenue = await Order.aggregate([
      { 
        $match: { 
          restaurant: restaurant._id,
          status: { $ne: 'cancelled' },
          createdAt: { $gte: todayStart, $lte: todayEnd }
        }
      },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);
        
    const pendingOrders = await Order.countDocuments({
      restaurant: restaurant._id,
      status: 'pending'
    });

    const totalOrders = await Order.countDocuments({
      restaurant: restaurant._id
    });

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const monthlyRevenue = await Order.aggregate([
      { 
        $match: { 
          restaurant: restaurant._id,
          status: { $ne: 'cancelled' },
          createdAt: { $gte: monthStart }
        }
      },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);

    const reservedTables = restaurant.hasTables ? 
      restaurant.tables.filter(table => table.isReserved).length : 0;

    // Get recent orders
    const recentOrders = await Order.find({
      restaurant: restaurant._id
    })
    .sort({ createdAt: -1 })
    .limit(5)
    .select('customerName totalAmount status createdAt orderType');

    res.json({
      restaurant,
      stats: {
        todayOrders,
        todayRevenue: todayRevenue[0]?.total || 0,
        monthlyRevenue: monthlyRevenue[0]?.total || 0,
        pendingOrders,
        totalOrders,
        reservedTables,
        totalTables: restaurant.totalTables || 0
      },
      recentOrders
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get Restaurant Menu
router.get('/menu', authenticate, authorizeRoles('restaurant'), async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.user.restaurantId._id);
    
    if (!restaurant) {
      return res.status(404).json({ message: 'المطعم غير موجود' });
    }

    res.json({
      menu: restaurant.menu,
      permissions: req.user.permissions || restaurant.permissions
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Add Menu Item
router.post('/menu', authenticate, authorizeRoles('restaurant'), checkPermission('canEditMenu'), async (req, res) => {
  try {
    const { name, description, price, ingredients, category, image } = req.body;

    if (!name || !price) {
      return res.status(400).json({ message: 'اسم الطبق والسعر مطلوبان' });
    }

    const restaurant = await Restaurant.findById(req.user.restaurantId._id);
    
    if (!restaurant) {
      return res.status(404).json({ message: 'المطعم غير موجود' });
    }

    const newMenuItem = {
      name,
      description,
      price: Number(price),
      ingredients: ingredients || [],
      category: category || 'أساسي',
      image,
      isAvailable: true
    };

    restaurant.menu.push(newMenuItem);
    await restaurant.save();

    res.status(201).json({
      message: 'تم إضافة العنصر للمنيو بنجاح',
      menuItem: restaurant.menu[restaurant.menu.length - 1]
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Update Menu Item
router.put('/menu/:itemId', authenticate, authorizeRoles('restaurant'), checkPermission('canEditMenu'), async (req, res) => {
  try {
    const { itemId } = req.params;
    const updates = req.body;

    const restaurant = await Restaurant.findById(req.user.restaurantId._id);
    
    if (!restaurant) {
      return res.status(404).json({ message: 'المطعم غير موجود' });
    }

    const menuItem = restaurant.menu.id(itemId);
    if (!menuItem) {
      return res.status(404).json({ message: 'العنصر غير موجود في المنيو' });
    }

    // Update allowed fields
    const allowedFields = ['name', 'description', 'price', 'ingredients', 'category', 'image', 'isAvailable'];
    allowedFields.forEach(field => {
      if (updates[field] !== undefined) {
        if (field === 'price') {
          menuItem[field] = Number(updates[field]);
        } else {
          menuItem[field] = updates[field];
        }
      }
    });

    await restaurant.save();

    res.json({
      message: 'تم تحديث العنصر بنجاح',
      menuItem
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Delete Menu Item
router.delete('/menu/:itemId', authenticate, authorizeRoles('restaurant'), checkPermission('canEditMenu'), async (req, res) => {
  try {
    const { itemId } = req.params;

    const restaurant = await Restaurant.findById(req.user.restaurantId._id);
    
    if (!restaurant) {
      return res.status(404).json({ message: 'المطعم غير موجود' });
    }

    const menuItem = restaurant.menu.id(itemId);
    if (!menuItem) {
      return res.status(404).json({ message: 'العنصر غير موجود في المنيو' });
    }

    restaurant.menu.pull(itemId);
    await restaurant.save();

    res.json({ message: 'تم حذف العنصر من المنيو بنجاح' });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Toggle Menu Item Availability
router.patch('/menu/:itemId/availability', authenticate, authorizeRoles('restaurant'), async (req, res) => {
  try {
    const { itemId } = req.params;
    const { isAvailable } = req.body;

    const restaurant = await Restaurant.findById(req.user.restaurantId._id);
    
    if (!restaurant) {
      return res.status(404).json({ message: 'المطعم غير موجود' });
    }

    const menuItem = restaurant.menu.id(itemId);
    if (!menuItem) {
      return res.status(404).json({ message: 'العنصر غير موجود في المنيو' });
    }

    menuItem.isAvailable = isAvailable;
    await restaurant.save();

    res.json({
      message: `تم ${isAvailable ? 'تفعيل' : 'إلغاء'} العنصر بنجاح`,
      menuItem
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
    if (status && status !== 'all') {
      query.status = status;
    }

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('restaurant', 'name');

    const total = await Order.countDocuments(query);

    // Group orders by status for quick stats
    const orderStats = await Order.aggregate([
      { $match: { restaurant: req.user.restaurantId._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    const stats = {};
    orderStats.forEach(stat => {
      stats[stat._id] = stat.count;
    });    
    
    res.json({
      orders,
      stats,
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

// Get Single Order
router.get('/orders/:orderId', authenticate, authorizeRoles('restaurant'), async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findOne({
      _id: orderId,
      restaurant: req.user.restaurantId._id
    }).populate('restaurant', 'name contact');

    if (!order) {
      return res.status(404).json({ message: 'الطلب غير موجود' });
    }

    res.json(order);
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Update Order Status
router.patch('/orders/:orderId/status', authenticate, authorizeRoles('restaurant'), async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;

    const validStatuses = ['pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'حالة الطلب غير صحيحة' });
    }

    const order = await Order.findOne({
      _id: orderId,
      restaurant: req.user.restaurantId._id
    });

    if (!order) {
      return res.status(404).json({ message: 'الطلب غير موجود' });
    }

    order.status = status;
    
    // Set estimated delivery time for confirmed orders
    if (status === 'confirmed' && !order.estimatedDeliveryTime) {
      order.estimatedDeliveryTime = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
    }

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
      return res.json({ 
        message: 'هذا المطعم لا يحتوي على طاولات', 
        tables: [],
        hasTables: false 
      });
    }

    res.json({
      tables: restaurant.tables,
      hasTables: true,
      totalTables: restaurant.totalTables
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Add New Table
router.post('/tables', authenticate, authorizeRoles('restaurant'), checkPermission('canManageTables'), async (req, res) => {
  try {
    const { capacity } = req.body;

    const restaurant = await Restaurant.findById(req.user.restaurantId._id);
    
    if (!restaurant) {
      return res.status(404).json({ message: 'المطعم غير موجود' });
    }

    if (!restaurant.hasTables) {
      return res.status(400).json({ message: 'هذا المطعم لا يدعم الطاولات' });
    }

    const newTableNumber = restaurant.tables.length + 1;
    const newTable = {
      number: newTableNumber,
      capacity: capacity || 4,
      isReserved: false
    };

    restaurant.tables.push(newTable);
    restaurant.totalTables = restaurant.tables.length;
    await restaurant.save();

    res.status(201).json({
      message: 'تم إضافة الطاولة بنجاح',
      table: restaurant.tables[restaurant.tables.length - 1]
    });
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
      table.reservationTime = reservationTime ? new Date(reservationTime) : new Date();
    } else {
      table.customerName = undefined;
      table.customerPhone = undefined;
      table.reservationTime = undefined;
    }

    await restaurant.save();

    res.json({
      message: `تم ${isReserved ? 'حجز' : 'إلغاء حجز'} الطاولة بنجاح`,
      table
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Delete Table
router.delete('/tables/:tableNumber', authenticate, authorizeRoles('restaurant'), checkPermission('canManageTables'), async (req, res) => {
  try {
    const { tableNumber } = req.params;

    const restaurant = await Restaurant.findById(req.user.restaurantId._id);
    
    if (!restaurant) {
      return res.status(404).json({ message: 'المطعم غير موجود' });
    }

    const tableIndex = restaurant.tables.findIndex(t => t.number == tableNumber);
    if (tableIndex === -1) {
      return res.status(404).json({ message: 'الطاولة غير موجودة' });
    }

    const table = restaurant.tables[tableIndex];
    if (table.isReserved) {
      return res.status(400).json({ message: 'لا يمكن حذف طاولة محجوزة' });
    }

    restaurant.tables.splice(tableIndex, 1);
    restaurant.totalTables = restaurant.tables.length;
    
    // Renumber remaining tables
    restaurant.tables.forEach((table, index) => {
      table.number = index + 1;
    });

    await restaurant.save();

    res.json({ message: 'تم حذف الطاولة بنجاح' });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get Sales Reports
router.get('/reports/sales', authenticate, authorizeRoles('restaurant'), checkPermission('canViewReports'), async (req, res) => {
  try {
    const { startDate, endDate, period } = req.query;
    
    let dateFilter = {};
    let groupBy = {};
    
    if (startDate && endDate) {
      dateFilter = {
        createdAt: {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        }
      };
    }

    // Determine grouping based on period
    switch (period) {
      case 'daily':
        groupBy = {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          day: { $dayOfMonth: '$createdAt' }
        };
        break;
      case 'weekly':
        groupBy = {
          year: { $year: '$createdAt' },
          week: { $week: '$createdAt' }
        };
        break;
      case 'monthly':
        groupBy = {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' }
        };
        break;
      default:
        groupBy = {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          day: { $dayOfMonth: '$createdAt' }
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
          _id: groupBy,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: '$totalAmount' },
          averageOrderValue: { $avg: '$totalAmount' },
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
          totalRevenue: { $sum: '$totalAmount' },
          averageOrderValue: { $avg: '$totalAmount' }
        }
      }
    ]);

    // Get popular items
    const popularItems = await Order.aggregate([
      {
        $match: {
          restaurant: req.user.restaurantId._id,
          status: { $ne: 'cancelled' },
          ...dateFilter
        }
      },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.name',
          totalOrdered: { $sum: '$items.quantity' },
          totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } }
        }
      },
      { $sort: { totalOrdered: -1 } },
      { $limit: 10 }
    ]);

    res.json({
      salesData,
      totalSales: totalSales[0] || { totalOrders: 0, totalRevenue: 0, averageOrderValue: 0 },
      popularItems
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Upload Restaurant Image
router.post('/upload-image', authenticate, authorizeRoles('restaurant'), async (req, res) => {
  try {
    const { image, type } = req.body; // type: 'logo' or 'gallery'
    
    if (!image) {
      return res.status(400).json({ message: 'لم يتم تحميل صورة' });
    }

    const imageBuffer = Buffer.from(image.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    const result = await uploadImage(imageBuffer, `restaurants/${req.user.restaurantId._id}`);

    const restaurant = await Restaurant.findById(req.user.restaurantId._id);
    
    if (type === 'logo') {
      restaurant.logo = result.secure_url;
    } else {
      if (!restaurant.images) {
        restaurant.images = [];
      }
      restaurant.images.push(result.secure_url);
    }

    await restaurant.save();

    res.json({
      message: 'تم تحميل الصورة بنجاح',
      url: result.secure_url,
      type
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في تحميل الصورة', error: error.message });
  }
});

// Change Password
router.post('/change-password', authenticate, authorizeRoles('restaurant'), [
  body('currentPassword').notEmpty().withMessage('كلمة المرور الحالية مطلوبة'),
  body('newPassword').isLength({ min: 6 }).withMessage('كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    // Check current password
    const isCurrentPasswordValid = await user.comparePassword(currentPassword);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({ message: 'كلمة المرور الحالية غير صحيحة' });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.json({ message: 'تم تغيير كلمة المرور بنجاح' });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get Order Analytics
router.get('/analytics/orders', authenticate, authorizeRoles('restaurant'), async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - parseInt(days));

    // Orders by day
    const ordersByDay = await Order.aggregate([
      {
        $match: {
          restaurant: req.user.restaurantId._id,
          createdAt: { $gte: daysAgo }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          orders: { $sum: 1 },
          revenue: { $sum: '$totalAmount' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    // Orders by status
    const ordersByStatus = await Order.aggregate([
      {
        $match: {
          restaurant: req.user.restaurantId._id,
          createdAt: { $gte: daysAgo }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Orders by type
    const ordersByType = await Order.aggregate([
      {
        $match: {
          restaurant: req.user.restaurantId._id,
          createdAt: { $gte: daysAgo }
        }
      },
      {
        $group: {
          _id: '$orderType',
          count: { $sum: 1 },
          revenue: { $sum: '$totalAmount' }
        }
      }
    ]);

    // Peak hours
    const ordersByHour = await Order.aggregate([
      {
        $match: {
          restaurant: req.user.restaurantId._id,
          createdAt: { $gte: daysAgo }
        }
      },
      {
        $group: {
          _id: { $hour: '$createdAt' },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    res.json({
      ordersByDay,
      ordersByStatus,
      ordersByType,
      ordersByHour
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get Customer Analytics
router.get('/analytics/customers', authenticate, authorizeRoles('restaurant'), async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - parseInt(days));

    // Top customers
    const topCustomers = await Order.aggregate([
      {
        $match: {
          restaurant: req.user.restaurantId._id,
          createdAt: { $gte: daysAgo },
          status: { $ne: 'cancelled' }
        }
      },
      {
        $group: {
          _id: {
            name: '$customerName',
            phone: '$customerPhone'
          },
          totalOrders: { $sum: 1 },
          totalSpent: { $sum: '$totalAmount' },
          averageOrderValue: { $avg: '$totalAmount' },
          lastOrderDate: { $max: '$createdAt' }
        }
      },
      { $sort: { totalSpent: -1 } },
      { $limit: 20 }
    ]);

    // New vs returning customers
    const customerStats = await Order.aggregate([
      {
        $match: {
          restaurant: req.user.restaurantId._id,
          createdAt: { $gte: daysAgo }
        }
      },
      {
        $group: {
          _id: {
            name: '$customerName',
            phone: '$customerPhone'
          },
          firstOrder: { $min: '$createdAt' },
          totalOrders: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: null,
          totalCustomers: { $sum: 1 },
          newCustomers: {
            $sum: {
              $cond: [{ $gte: ['$firstOrder', daysAgo] }, 1, 0]
            }
          },
          returningCustomers: {
            $sum: {
              $cond: [{ $gt: ['$totalOrders', 1] }, 1, 0]
            }
          }
        }
      }
    ]);

    res.json({
      topCustomers,
      customerStats: customerStats[0] || { totalCustomers: 0, newCustomers: 0, returningCustomers: 0 }
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Export Menu Data
router.get('/export/menu', authenticate, authorizeRoles('restaurant'), async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.user.restaurantId._id);
    
    if (!restaurant) {
      return res.status(404).json({ message: 'المطعم غير موجود' });
    }

    const menuData = restaurant.menu.map(item => ({
      name: item.name,
      description: item.description,
      price: item.price,
      category: item.category,
      ingredients: item.ingredients.join(', '),
      available: item.isAvailable ? 'متوفر' : 'غير متوفر'
    }));

    res.json({
      restaurantName: restaurant.name,
      exportDate: new Date(),
      menu: menuData
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get Menu Categories
router.get('/menu/categories', authenticate, authorizeRoles('restaurant'), async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.user.restaurantId._id);
    
    if (!restaurant) {
      return res.status(404).json({ message: 'المطعم غير موجود' });
    }

    const categories = [...new Set(restaurant.menu.map(item => item.category))].filter(Boolean);
    
    const categoryStats = await Promise.all(
      categories.map(async (category) => {
        const items = restaurant.menu.filter(item => item.category === category);
        const availableItems = items.filter(item => item.isAvailable);
        
        return {
          name: category,
          totalItems: items.length,
          availableItems: availableItems.length,
          avgPrice: items.reduce((sum, item) => sum + item.price, 0) / items.length
        };
      })
    );

    res.json({
      categories,
      categoryStats
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Bulk Update Menu Items
router.patch('/menu/bulk-update', authenticate, authorizeRoles('restaurant'), checkPermission('canEditMenu'), async (req, res) => {
  try {
    const { updates } = req.body; // Array of {itemId, updates}
    
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ message: 'بيانات التحديث غير صحيحة' });
    }

    const restaurant = await Restaurant.findById(req.user.restaurantId._id);
    
    if (!restaurant) {
      return res.status(404).json({ message: 'المطعم غير موجود' });
    }

    let updatedCount = 0;
    const results = [];

    for (const update of updates) {
      const { itemId, changes } = update;
      const menuItem = restaurant.menu.id(itemId);
      
      if (menuItem) {
        const allowedFields = ['name', 'description', 'price', 'ingredients', 'category', 'image', 'isAvailable'];
        
        Object.keys(changes).forEach(field => {
          if (allowedFields.includes(field) && changes[field] !== undefined) {
            if (field === 'price') {
              menuItem[field] = Number(changes[field]);
            } else {
              menuItem[field] = changes[field];
            }
          }
        });
        
        updatedCount++;
        results.push({ itemId, status: 'updated', item: menuItem });
      } else {
        results.push({ itemId, status: 'not_found' });
      }
    }

    await restaurant.save();

    res.json({
      message: `تم تحديث ${updatedCount} عنصر بنجاح`,
      updatedCount,
      results
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get Restaurant Settings
router.get('/settings', authenticate, authorizeRoles('restaurant'), async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.user.restaurantId._id);
    const user = await User.findById(req.user._id).select('-password');
    
    if (!restaurant) {
      return res.status(404).json({ message: 'المطعم غير موجود' });
    }

    res.json({
      restaurant: {
        name: restaurant.name,
        description: restaurant.description,
        logo: restaurant.logo,
        images: restaurant.images,
        contact: restaurant.contact,
        hasTables: restaurant.hasTables,
        totalTables: restaurant.totalTables
      },
      user: {
        email: user.email,
        permissions: user.permissions
      },
      permissions: restaurant.permissions
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Update Restaurant Settings
router.put('/settings', authenticate, authorizeRoles('restaurant'), async (req, res) => {
  try {
    const { restaurant: restaurantData, contact } = req.body;

    const restaurant = await Restaurant.findById(req.user.restaurantId._id);
    
    if (!restaurant) {
      return res.status(404).json({ message: 'المطعم غير موجود' });
    }

    // Update allowed fields
    if (restaurantData.name) restaurant.name = restaurantData.name;
    if (restaurantData.description !== undefined) restaurant.description = restaurantData.description;
    if (contact) restaurant.contact = { ...restaurant.contact, ...contact };

    await restaurant.save();

    res.json({
      message: 'تم تحديث إعدادات المطعم بنجاح',
      restaurant
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get Menu Item Details
router.get('/menu/:itemId', authenticate, authorizeRoles('restaurant'), async (req, res) => {
  try {
    const { itemId } = req.params;
    const restaurant = await Restaurant.findById(req.user.restaurantId._id);
    
    if (!restaurant) {
      return res.status(404).json({ message: 'المطعم غير موجود' });
    }

    const menuItem = restaurant.menu.id(itemId);
    if (!menuItem) {
      return res.status(404).json({ message: 'العنصر غير موجود في المنيو' });
    }

    res.json(menuItem);
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get Popular Menu Items
router.get('/menu/popular/items', authenticate, authorizeRoles('restaurant'), async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - parseInt(days));

    const popularItems = await Order.aggregate([
      {
        $match: {
          restaurant: req.user.restaurantId._id,
          status: { $ne: 'cancelled' },
          createdAt: { $gte: daysAgo }
        }
      },
      { $unwind: '$items' },
      {
        $group: {
          _id: {
            itemId: '$items.menuItem',
            name: '$items.name'
          },
          totalOrdered: { $sum: '$items.quantity' },
          totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
          orderCount: { $sum: 1 }
        }
      },
      { $sort: { totalOrdered: -1 } },
      { $limit: 10 }
    ]);

    res.json(popularItems);
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get Revenue Summary
router.get('/revenue/summary', authenticate, authorizeRoles('restaurant'), async (req, res) => {
  try {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const thisWeek = new Date(today);
    thisWeek.setDate(thisWeek.getDate() - 7);
    
    const thisMonth = new Date(today);
    thisMonth.setMonth(thisMonth.getMonth() - 1);

    // Today's revenue
    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(today);
    todayEnd.setHours(23, 59, 59, 999);

    const todayRevenue = await Order.aggregate([
      {
        $match: {
          restaurant: req.user.restaurantId._id,
          status: { $ne: 'cancelled' },
          createdAt: { $gte: todayStart, $lte: todayEnd }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$totalAmount' },
          orders: { $sum: 1 }
        }
      }
    ]);

    // This week's revenue
    const weekRevenue = await Order.aggregate([
      {
        $match: {
          restaurant: req.user.restaurantId._id,
          status: { $ne: 'cancelled' },
          createdAt: { $gte: thisWeek }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$totalAmount' },
          orders: { $sum: 1 }
        }
      }
    ]);

    // This month's revenue
    const monthRevenue = await Order.aggregate([
      {
        $match: {
          restaurant: req.user.restaurantId._id,
          status: { $ne: 'cancelled' },
          createdAt: { $gte: thisMonth }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$totalAmount' },
          orders: { $sum: 1 }
        }
      }
    ]);

    res.json({
      today: todayRevenue[0] || { total: 0, orders: 0 },
      thisWeek: weekRevenue[0] || { total: 0, orders: 0 },
      thisMonth: monthRevenue[0] || { total: 0, orders: 0 }
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Update Table Capacity
router.patch('/tables/:tableNumber/capacity', authenticate, authorizeRoles('restaurant'), checkPermission('canManageTables'), async (req, res) => {
  try {
    const { tableNumber } = req.params;
    const { capacity } = req.body;

    if (!capacity || capacity < 1) {
      return res.status(400).json({ message: 'سعة الطاولة يجب أن تكون رقم موجب' });
    }

    const restaurant = await Restaurant.findById(req.user.restaurantId._id);
    
    if (!restaurant) {
      return res.status(404).json({ message: 'المطعم غير موجود' });
    }

    const table = restaurant.tables.find(t => t.number == tableNumber);
    if (!table) {
      return res.status(404).json({ message: 'الطاولة غير موجودة' });
    }

    table.capacity = capacity;
    await restaurant.save();

    res.json({
      message: 'تم تحديث سعة الطاولة بنجاح',
      table
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get Table Reservations for Today
router.get('/tables/reservations/today', authenticate, authorizeRoles('restaurant'), async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.user.restaurantId._id);
    
    if (!restaurant) {
      return res.status(404).json({ message: 'المطعم غير موجود' });
    }

    if (!restaurant.hasTables) {
      return res.json({ reservations: [] });
    }

    const today = new Date();
    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(today);
    todayEnd.setHours(23, 59, 59, 999);

    const todayReservations = restaurant.tables.filter(table => {
      return table.isReserved && 
             table.reservationTime && 
             table.reservationTime >= todayStart && 
             table.reservationTime <= todayEnd;
    });

    res.json({
      reservations: todayReservations,
      totalReservations: todayReservations.length,
      availableTables: restaurant.tables.filter(table => !table.isReserved).length
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get Recent Activity
router.get('/activity/recent', authenticate, authorizeRoles('restaurant'), async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    
    const recentOrders = await Order.find({
      restaurant: req.user.restaurantId._id
    })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('customerName totalAmount status createdAt orderType');

    const activities = recentOrders.map(order => ({
      type: 'order',
      message: `طلب جديد من ${order.customerName} بقيمة ${order.totalAmount} ريال`,
      status: order.status,
      time: order.createdAt,
      orderType: order.orderType
    }));

    res.json(activities);
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Delete Restaurant Image
router.delete('/images/:imageIndex', authenticate, authorizeRoles('restaurant'), async (req, res) => {
  try {
    const { imageIndex } = req.params;
    const restaurant = await Restaurant.findById(req.user.restaurantId._id);
    
    if (!restaurant) {
      return res.status(404).json({ message: 'المطعم غير موجود' });
    }

    if (!restaurant.images || imageIndex >= restaurant.images.length) {
      return res.status(404).json({ message: 'الصورة غير موجودة' });
    }

    restaurant.images.splice(imageIndex, 1);
    await restaurant.save();

    res.json({ message: 'تم حذف الصورة بنجاح' });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

module.exports = router;
          