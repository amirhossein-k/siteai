// Backup script for marlooai database using mongosh
// Exports all collections to JSON files

const fs = require('fs');
const path = require('path');

const backupDir = '/home/deploy/marlooai_backup_' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
fs.mkdirSync(backupDir, { recursive: true });

const db = db.getSiblingDB('marlooai');
const collections = db.getCollectionNames().sort();

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
