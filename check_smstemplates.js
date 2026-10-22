db.smstemplates.find().forEach(t => {
  print(JSON.stringify({
    name: t.name,
    templateName: t.templateName,
    provider: t.provider,
    isActive: t.isActive
  }));
});
