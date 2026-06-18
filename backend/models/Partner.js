const mongoose = require('mongoose');

const partnerSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  phone: String,
  restaurantsAdded: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Restaurant'
  }],
  totalRestaurants: {
    type: Number,
    default: 0
  },
  permissions: {
    canAddRestaurant: { type: Boolean, default: false },
    canEditRestaurant: { type: Boolean, default: false },
    canViewReports: { type: Boolean, default: false }
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Partner', partnerSchema);