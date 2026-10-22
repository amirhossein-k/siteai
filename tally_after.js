const counts = {};
db.getCollectionNames().sort().forEach(c => {
  counts[c] = db.getCollection(c).countDocuments();
});
print(JSON.stringify(counts, null, 2));
