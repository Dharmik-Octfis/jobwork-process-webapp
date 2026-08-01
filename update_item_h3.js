const fs = require('fs');

['web/src/features/items/CreateItemPage.tsx', 'web/src/features/items/EditItemPage.tsx'].forEach(file => {
  let content = fs.readFileSync(file, 'utf8');

  // Replace 'Custom Fields' inside the <h3>
  content = content.replace(
    /(<h3[^>]*>\s*)Custom Fields(\s*<\/h3>)/,
    `$1Custom Fields{customFields.some((f: any) => f.isRequired) && <span style={{ color: '#ef4444' }}>*</span>}$2`
  );

  fs.writeFileSync(file, content);
  console.log('Updated ' + file);
});
