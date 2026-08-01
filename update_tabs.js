const fs = require('fs');

const files = [
  { path: 'web/src/features/sales/customers/CustomerForm.tsx', entity: 'customer', customFieldsImport: '../../custom-fields/customFields.api' },
  { path: 'web/src/features/purchases/vendors/VendorForm.tsx', entity: 'vendor', customFieldsImport: '../../custom-fields/customFields.api' },
  { path: 'web/src/features/items/CreateItemPage.tsx', entity: 'item', customFieldsImport: '../custom-fields/customFields.api' },
  { path: 'web/src/features/items/EditItemPage.tsx', entity: 'item', customFieldsImport: '../custom-fields/customFields.api' }
];

files.forEach(f => {
  let content = fs.readFileSync(f.path, 'utf8');

  // 1. Add import if not present
  if (!content.includes('useActiveCustomFields')) {
    content = content.replace(/(import .*;\n)/, `$1import { useActiveCustomFields } from '${f.customFieldsImport}';\n`);
  }

  // 2. Add hook call
  if (!content.includes('const { data: customFields = [] } = useActiveCustomFields')) {
    content = content.replace(/(const \{ orgId.*? \} = useParams.*?;)/, `$1\n  const { data: customFields = [] } = useActiveCustomFields(orgId!, '${f.entity}');`);
  }

  // 3. Replace 'Custom Fields' tab button text
  // We need to find the specific tab button for Custom Fields and replace the inner text
  // It looks like:
  // >
  //   Custom Fields
  // </button>
  // Or
  // >Custom Fields</button>
  // Let's use a regex to match the button that sets activeTab to 'custom'.
  
  content = content.replace(
    /(onClick=\{\(\) => setActiveTab\('custom'\)\}[^>]*>\s*)Custom Fields(\s*<\/button>)/,
    `$1Custom Fields{customFields.some((f: any) => f.isRequired) && <span style={{ color: '#ef4444' }}>*</span>}$2`
  );

  fs.writeFileSync(f.path, content);
  console.log('Updated ' + f.path);
});
