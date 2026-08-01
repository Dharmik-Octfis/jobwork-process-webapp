const fs = require('fs');

const files = [
  'web/src/features/configuration/locations/LocationForm.tsx',
  'web/src/features/custom-fields/FieldForm.tsx',
  'web/src/features/items/CreateItemPage.tsx',
  'web/src/features/items/EditItemPage.tsx',
  'web/src/features/purchases/purchase-orders/CreatePurchaseOrder.tsx',
  'web/src/features/purchases/vendors/VendorForm.tsx',
  'web/src/features/sales/customers/CustomerForm.tsx',
  'web/src/features/sales/customers/PaymentTermModal.tsx'
];

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');

  // Replace <label style={{ fontSize: 12, color: '#4b5563', fontWeight: 500 }}>Name<span style={{ color: '#e54d4d', marginLeft: '2px' }}>*</span>
  content = content.replace(/<label style=\{\{ fontSize: 12, color: '#4b5563', fontWeight: 500 \}\}>([^<]+)<span[^>]*>\*<\/span>/g, 
    '<label style={{ fontSize: 12, color: \'#ef4444\', fontWeight: 500 }}>$1*');

  // Replace <label style={labelStyle}>...<span ...>*</span>
  content = content.replace(/<label style=\{labelStyle\}>([^<]+)<span[^>]*>\*<\/span>/g,
    '<label style={{ ...labelStyle, color: \'#ef4444\' }}>$1*');

  // Replace <label style={labelCol}>...<span ...>*</span>
  content = content.replace(/<label style=\{labelCol\}>([^<]+)<span[^>]*>\*<\/span>/g,
    '<label style={{ ...labelCol, color: \'#ef4444\' }}>$1*');

  // Replace <label style={{ ...labelStyle, alignSelf: 'flex-start' }}>...<span ...>*</span>
  content = content.replace(/<label style=\{\{ \.\.\.labelStyle, alignSelf: 'flex-start' \}\}>([^<]+)<span[^>]*>\*<\/span>/g,
    '<label style={{ ...labelStyle, alignSelf: \'flex-start\', color: \'#ef4444\' }}>$1*');

  // Replace <label style={{ fontSize: '14px', color: '#111' }}>...<span ...>*</span>
  content = content.replace(/<label style=\{\{ fontSize: '14px', color: '#111' \}\}>([^<]+)<span[^>]*>\*<\/span>/g,
    '<label style={{ fontSize: \'14px\', color: \'#ef4444\' }}>$1*');

  // Fix trailing spaces: Name* </label> -> Name*</label>
  content = content.replace(/\*\s+<\/label>/g, '*</label>');

  fs.writeFileSync(file, content);
});

// Fix CustomFieldsSection.tsx
let customFields = fs.readFileSync('web/src/features/custom-fields/CustomFieldsSection.tsx', 'utf8');
customFields = customFields.replace(/<label style=\{labelStyle\}>/, '<label style={def.isRequired ? { ...labelStyle, color: \'#ef4444\' } : labelStyle}>');
customFields = customFields.replace(/\{def\.isRequired && <span[^>]*>\*<\/span>\}/, '{def.isRequired && \'*\'}');
fs.writeFileSync('web/src/features/custom-fields/CustomFieldsSection.tsx', customFields);

// Fix Input.tsx
let input = fs.readFileSync('web/src/components/ui/Input.tsx', 'utf8');
input = input.replace(/<label className=\{styles\.label\} htmlFor=\{inputId\}>/, '<label className={styles.label} htmlFor={inputId} style={rest.required ? { color: \'#ef4444\' } : undefined}>');
input = input.replace(/\{rest\.required && <span[^>]*>\*<\/span>\}/, '{rest.required && \'*\'}');
fs.writeFileSync('web/src/components/ui/Input.tsx', input);

console.log('Done!');
