const mongoose = require('mongoose');

const menuItemSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  description: String,
  price: {
    type: Number,
    required: true
  },
  ingredients: [String],
  category: String,
  image: String,
  isAvailable: {
    type: Boolean,
    default: true
  }
});

const tableSchema = new mongoose.Schema({
  number: {
    type: Number,
    required: true
  },
  capacity: {
    type: Number,
    required: true
  },
  isReserved: {
    type: Boolean,
    default: false
  },
  reservationTime: Date,
  customerName: String,
  customerPhone: String
});

const restaurantSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  description: String,
  logo: String,
  images: [String],
  menu: [menuItemSchema],
  hasTables: {
    type: Boolean,
    default: false
  },
  tables: [tableSchema],
  totalTables: {
    type: Number,
    default: 0
  },
  contact: {
    phone: String,
    email: String,
    address: String
  },
  isActive: {
    type: Boolean,
    default: true
  },
  totalOrders: {
    type: Number,
    default: 0
  },
  totalRevenue: {
    type: Number,
    default: 0
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  permissions: {
    canEditMenu: { type: Boolean, default: false },
    canManageTables: { type: Boolean, default: false },
    canViewReports: { type: Boolean, default: false }
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Restaurant', restaurantSchema);