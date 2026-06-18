const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const Partner = require('../models/Partner');
const { authenticate, authorizeRoles, checkPermission } = require('../middleware/auth');
const { sendRestaurantCredentials } = require('../utils/email');

const router = express.Router();

// Partner Login
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
    const user = await User.findOne({ email, role: 'partner' });

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'بيانات الدخول غير صحيحة' });
    }

    if (!user.isActive) {
      return res.status(401).json({ message: 'الحساب محظور' });
    }

    const partner = await Partner.findOne({ userId: user._id });

    const token = jwt.sign(
      { userId: user._id, role: user.role, partnerId: partner._id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        partner,
        permissions: user.permissions
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get Partner Dashboard
router.get('/dashboard', authenticate, authorizeRoles('partner'), async (req, res) => {
  try {
    const partner = await Partner.findOne({ userId: req.user._id })
      .populate('restaurantsAdded', 'name isActive totalOrders');

    if (!partner) {
      return res.status(404).json({ message: 'الشريك غير موجود' });
    }

    const totalRestaurants = partner.restaurantsAdded.length;
    const activeRestaurants = partner.restaurantsAdded.filter(r => r.isActive).length;
    
    res.json({
      partner,
      totalRestaurants,
      activeRestaurants,
      restaurants: partner.restaurantsAdded
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Add Restaurant (Partner)
router.post('/restaurants', authenticate, authorizeRoles('partner'), checkPermission('canAddRestaurant'), async (req, res) => {
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
      permissions,
      createdBy: req.user._id
    });

    await user.save();

    // Update partner's restaurant list
    const partner = await Partner.findOne({ userId: req.user._id });
    partner.restaurantsAdded.push(restaurant._id);
    partner.totalRestaurants = partner.restaurantsAdded.length;
    await partner.save();

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
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get Partner's Restaurants
router.get('/restaurants', authenticate, authorizeRoles('partner'), async (req, res) => {
  try {
    const partner = await Partner.findOne({ userId: req.user._id })
      .populate({
        path: 'restaurantsAdded',
        populate: {
          path: 'createdBy',
          select: 'email'
        }
      });

    if (!partner) {
      return res.status(404).json({ message: 'الشريك غير موجود' });
    }

    res.json(partner.restaurantsAdded);
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

module.exports = router;

