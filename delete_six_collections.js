// Deletion script for the six authorized target collections
// Dependency-aware order: supplierorders -> orders -> others

const collections = [
  'supplierorders',
  'orders',
  'purchaseorders',
  'inventorymovements',
  'expenses',
  'smsproviderstates'
];

const results = {};

for (const collName of collections) {
  const coll = db.getCollection(collName);
  const beforeCount = coll.countDocuments();
  const r = coll.deleteMany({});
  results[collName] = {
    beforeCount: beforeCount,
    deletedCount: r.deletedCount,
    acknowledged: r.acknowledged
  };
  print(JSON.stringify({
    collection: collName,
    beforeCount: beforeCount,
    deletedCount: r.deletedCount,
    acknowledged: r.acknowledged
  }));
}

print('---');
print('DELETION_COMPLETE');
print(JSON.stringify(results, null, 2));
