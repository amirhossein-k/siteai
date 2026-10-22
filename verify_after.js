// Step 5: Test marker scan
// Step 7: Referential integrity checks

print('=== STEP 5: TEST MARKER SCAN ===');

const markers = ['e2e_', 'otp62_', 'mock', 'probe', 'cmark_', 'polish_', 'COUPON_', 'CMARK_', 'CELIG_', 'DISCO_'];

// Check users for test markers
const testUsers = db.users.find({
  $or: [
    { phone: { $regex: 'otp62_' } },
    { name: { $regex: 'e2e_' } },
    { name: { $regex: 'mock' } },
    { name: { $regex: 'probe' } }
  ]
}).toArray();
print('Users with test markers: ' + testUsers.length);

// Check smstemplates for test markers
const testTemplates = db.smstemplates.find({
  $or: [
    { name: { $regex: 'e2e_' } },
    { name: { $regex: 'probe' } },
    { name: { $regex: 'mock' } }
  ]
}).toArray();
print('SMS templates with test markers: ' + testTemplates.length);
testTemplates.forEach(t => print('  Remaining: ' + t.name));

// Check coupons for test markers (should be 0)
const testCoupons = db.coupons.find({
  $or: [
    { code: { $regex: 'e2e_' } },
    { code: { $regex: 'COUPON_' } },
    { code: { $regex: 'CMARK_' } },
    { code: { $regex: 'CELIG_' } },
    { code: { $regex: 'DISCO_' } }
  ]
}).toArray();
print('Coupons with test markers: ' + testCoupons.length);

// Check categories for test markers
const testCategories = db.categories.find({
  $or: [
    { name: { $regex: 'e2e_' } },
    { slug: { $regex: 'e2e_' } },
    { slug: { $regex: 'oc_' } },
    { slug: { $regex: 'om_' } },
    { slug: { $regex: 'pstamp_' } }
  ]
}).toArray();
print('Categories with test markers: ' + testCategories.length);

// Check attributes for test markers
const testAttributes = db.attributes.find({
  $or: [
    { name: { $regex: 'e2e_' } },
    { name: { $regex: 'pstamp_' } }
  ]
}).toArray();
print('Attributes with test markers: ' + testAttributes.length);

// Check suppliers for test markers
const testSuppliers = db.suppliers.find({
  $or: [
    { businessName: { $regex: 'e2e_' } },
    { name: { $regex: 'e2e_' } }
  ]
}).toArray();
print('Suppliers with test markers: ' + testSuppliers.length);

print('');
print('=== STEP 7: REFERENTIAL INTEGRITY ===');

// Orders → users/products/coupons
const orders = db.orders.find().toArray();
print('Total orders: ' + orders.length);
let danglingOrders = 0;
for (const o of orders) {
  if (o.userId && !db.users.findOne({ _id: o.userId })) {
    print('  DANGLING: order ' + o._id + ' references missing user ' + o.userId);
    danglingOrders++;
  }
}
print('Orders with dangling user references: ' + danglingOrders);

// Supplier orders → suppliers
const supplierOrders = db.supplierorders.find().toArray();
print('Total supplierorders: ' + supplierOrders.length);

// Purchase orders → suppliers
const purchaseOrders = db.purchaseorders.find().toArray();
print('Total purchaseorders: ' + purchaseOrders.length);

// Inventory movements
const inventoryMovements = db.inventorymovements.find().toArray();
print('Total inventorymovements: ' + inventoryMovements.length);

// Expenses
const expenses = db.expenses.find().toArray();
print('Total expenses: ' + expenses.length);

print('');
print('=== STEP 6: ADMIN VERIFICATION ===');
const admin = db.users.findOne({ phone: '09391470427' });
print(JSON.stringify({
  adminExists: !!admin,
  adminRole: admin?.role,
  adminIsActive: admin?.isActive
}));

print('');
print('=== VERIFICATION COMPLETE ===');
