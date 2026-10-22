// Inspect schema and references for the six target collections
const collections = ['orders', 'supplierorders', 'purchaseorders', 'inventorymovements', 'expenses', 'smsproviderstates'];

for (const collName of collections) {
  print('=== ' + collName + ' ===');
  const doc = db.getCollection(collName).findOne();
  if (doc) {
    print(JSON.stringify(doc, null, 2));
  } else {
    print('(empty collection)');
  }
  print('');
}
