// routers/orderRoutes.js
const express = require('express');
const Restaurant = require('../models/Restaurant');
const Order = require('../models/Order');

const router = express.Router();

// Create Order (from AI Agent)
// router.post('/create/:restaurantId', async (req, res) => {  
//   try {
//     console.log("Request Body:", req.body); // Log the entire request body for debugging
    
//     res.status(201).json({
//       message: 'the order has been created successfully.',
//     });
//   } catch (error) {
//     console.error('❌ خطأ في إنشاء الطلب:', error);
//     res.status(500).json({ message: 'خطأ في إنشاء الطلب', error: error.message });
//   }
// });





router.post('/create/:restaurantId', async (req, res) => {  
  try {
    const restaurantId = req.params.restaurantId; 
    const customerName = req.body.args?.customerName || 'Anonymous client';
    const customerPhone = req.body.args?.customerPhone || '0000000000';
    const items = req.body.args?.items || [];
    const orderType = req.body.args?.orderType || 'pickup';
    const tableNumber = req.body.args?.tableNumber;
    const notes = req.body.args?.notes || '';
    const textMessage = req.body.call?.transcript || '';
    const address = req.body.args?.address || 'none';
    const totalAmount = req.body.args?.totalAmount || 0;
    

    // Validate restaurant
    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant || !restaurant.isActive) {
      return res.status(404).json({ message: 'The restaurant is not available or inactive.' });
    }

    // Calculate total amount & prepare items
    const orderItems = [];

    for (const item of items) {
      let menuItem;

      // ✅ إذا جاي menuItemId استخدمه، غير هيك دور بالاسم
      if (item.menuItemId) {
        menuItem = restaurant.menu.id(item.menuItemId);
      } else if (item.name) {
        menuItem = restaurant.menu.find(m => m.name === item.name);
      }

      if (!menuItem || !menuItem.isAvailable) {
        return res.status(400).json({
          message: `العنصر ${item.name || 'غير محدد'} غير متوفر`
        });
      }

      const quantity = item.quantity || 1;

      const orderItem = {
        menuItem: menuItem._id,
        name: menuItem.name,
        price: menuItem.price,
        quantity
      };

      orderItems.push(orderItem);
    }
    
    // Create order
    
    const order = new Order({
      restaurant: restaurantId,
      customerName,
      customerPhone,
      items,
      orderType: orderType || 'pickup',
      tableNumber,
      notes,
      status: 'pending',
      textMessage,
      totalAmount,
      address
    });

    await order.save();

    // Update restaurant statistics
    await Restaurant.findByIdAndUpdate(restaurantId, {
      $inc: {
        totalOrders: 1,
        totalRevenue: totalAmount
      }
    });
    res.status(201).json({
      message: 'the order has been created successfully.',
      order: {
        id: order._id,
        customerName: order.customerName,
        status: order.status,
        orderTime: order.orderTime,
        estimatedDeliveryTime: new Date(Date.now() + 30 * 60 * 1000) // 30 دقيقة من الآن
      }
    });
  } catch (error) {
    console.error('❌ خطأ في إنشاء الطلب:', error);
    res.status(500).json({ message: 'خطأ في إنشاء الطلب', error: error.message });
  }
});


// Get Restaurant Menu (Public - for AI Agent)
router.get('/menu/:restaurantId', async (req, res) => {
  try {    
    const restaurant = await Restaurant.findById(req.params.restaurantId);
    console.log("sajed sfbjkdgfnjfg");
    if (!restaurant || !restaurant.isActive) {
      return res.status(404).json({ message: 'المطعم غير موجود أو غير نشط' });
    }

    const availableMenu = restaurant.menu.filter(item => item.isAvailable);

    res.json({
      restaurantName: restaurant.name,
      menu: availableMenu,
      hasTables: restaurant.hasTables,
      availableTables: restaurant.hasTables ? 
        restaurant.tables.filter(table => !table.isReserved).length : 0
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get Order Status (Public - for AI Agent)
router.get('/status/:orderId', async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId)
      .populate('restaurant', 'name phone');

    if (!order) {
      return res.status(404).json({ message: 'الطلب غير موجود' });
    }

    res.json({
      orderId: order._id,
      status: order.status,
      customerName: order.customerName,
      totalAmount: order.totalAmount,
      orderTime: order.orderTime,
      estimatedDeliveryTime: order.estimatedDeliveryTime,
      restaurant: {
        name: order.restaurant.name,
        phone: order.restaurant.phone
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

module.exports = router;