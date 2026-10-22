const ids = [
  ObjectId('6ac9eacca2444171b2d50b85'),
  ObjectId('6ac9ead3a2444171b2d50ba2'),
  ObjectId('6ac9f6c5a2444171b2d510b9'),
  ObjectId('6ac9f714a2444171b2d510c2'),
  ObjectId('6ac9f7f2a2444171b2d510ef'),
  ObjectId('6ac9f9a9a2444171b2d511f1')
];

const r = db.smstemplates.deleteMany({ _id: { $in: ids } });
print(JSON.stringify({deletedCount: r.deletedCount, acknowledged: r.acknowledged}));
