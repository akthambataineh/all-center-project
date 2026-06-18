const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  menuItem: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  name: String,
  price: Number,
  quantity: {
    type: Number,
    required: true,
    default: 1
  },
  notes: String
});

const orderSchema = new mongoose.Schema({
  restaurant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Restaurant',
    required: true
  },
  textMessage: {
    type: String,
  },

  customerName: String,
  customerPhone: String,
  items: [orderItemSchema],
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled'],
    default: 'pending'
  },
  address: {
    type: String,
    default: 'none'
  },
  orderType: {
    type: String,
    enum: ['delivery', 'pickup', 'dine-in'],
    default: 'pickup'
  },
  tableNumber: Number,
  orderTime: {
    type: Date,
    default: Date.now
  },
  totalAmount: {
    type: Number,
    default: 0
  },
  estimatedDeliveryTime: Date,
}, {
  timestamps: true
});

module.exports = mongoose.model('Order', orderSchema);