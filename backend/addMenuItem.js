// addMultipleMenuItems.js
const mongoose = require('mongoose');
const Restaurant = require('./models/Restaurant'); // change the path if needed
require('dotenv').config();

// Connect to the database
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ Connected to the database'))
.catch(err => console.error('❌ Database connection error:', err));

async function addMenuItems() {
  try {
    // 👈 Replace with the actual restaurant ID
    const restaurantId = '68b89d11933777014e60cf44'; 

    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) {
      console.log('❌ Restaurant not found');
      return;
    }

    // Array of new menu items
    const menuItems = [
      {
        name: 'coca cola',
        description: '',
        price: 6,
        ingredients: [],
        category: 'beverages',
        isAvailable: true
      },
    ];

    // Add all items in a loop
    menuItems.forEach(item => {
      restaurant.menu.push(item);
    });

    await restaurant.save();

    console.log(`✅ Added ${menuItems.length} menu items successfully!`);
  } catch (err) {
    console.error('❌ Error while adding menu items:', err.message);
  } finally {
    mongoose.connection.close();
  }
}

addMenuItems();
