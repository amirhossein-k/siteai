// Backup script for the six authorized target collections
const fs = require('fs');
const path = require('path');

const backupDir = '/home/deploy/ooai_cleanup_backup_20261022_030232';
fs.mkdirSync(backupDir, { recursive: true });

const db = db.getSiblingDB('marlooai');
const collections = ['orders', 'supplierorders', 'purchaseorders', 'inventorymovements', 'expenses', 'smsproviderstates'];

print('BACKUP_START');
print('Database: marlooai');
print('Backup directory: ' + backupDir);
print('Collections: ' + collections.join(', '));
print('---');

let totalDocs = 0;
for (const collName of collections) {
  const coll = db.getCollection(collName);
  const docs = coll.find().toArray();
  const filePath = path.join(backupDir, collName + '.json');
  fs.writeFileSync(filePath, JSON.stringify(docs, null, 2));
  totalDocs += docs.length;
  print(collName + ': ' + docs.length + ' documents -> ' + filePath);
}

print('---');
print('BACKUP_COMPLETE');
print('Total documents backed up: ' + totalDocs);
print('Backup directory: ' + backupDir);
