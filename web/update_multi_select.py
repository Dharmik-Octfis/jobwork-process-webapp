import re

files = [
    'e:/octfis-project/jobwork-process-webapp/web/src/features/inventory/composite-items/CreateCompositeItemPage.tsx',
    'e:/octfis-project/jobwork-process-webapp/web/src/features/inventory/composite-items/EditCompositeItemPage.tsx'
]

import_str = """
import { MultiSelectItemModal } from '../../items/components/MultiSelectItemModal';
import type { MultiSelectItem } from '../../items/components/MultiSelectItemModal';
"""

state_str = """
  const [isMultiSelectItemModalOpen, setIsMultiSelectItemModalOpen] = useState(false);
  const [multiSelectTargetIndex, setMultiSelectTargetIndex] = useState<number | null>(null);
"""

on_open_multi_select = """
                        onOpenMultiSelect={() => {
                          setMultiSelectTargetIndex(idx);
                          setIsMultiSelectItemModalOpen(true);
                        }}
"""

modal_str = """
      <MultiSelectItemModal
        isOpen={isMultiSelectItemModalOpen}
        onClose={() => {
          setIsMultiSelectItemModalOpen(false);
          setMultiSelectTargetIndex(null);
        }}
        orgId={orgId!}
        onAssign={(selectedItems) => {
          if (selectedItems.length === 0 || multiSelectTargetIndex === null) return;

          setComponents((prev) => {
            const newComponents = [...prev];
            const targetIndex = multiSelectTargetIndex;

            selectedItems.forEach((item, i) => {
              const isFirst = i === 0;
              const targetRow = newComponents[targetIndex];
              const isEmptyRow = !targetRow?.componentItemId;

              const qty = Number(item._quantity) || 1;

              if (isFirst && isEmptyRow) {
                newComponents[targetIndex] = {
                  ...targetRow,
                  componentItemId: item.id,
                  itemDetails: item,
                  qtyPerUnit: qty,
                };
              } else {
                newComponents.push({
                  componentItemId: item.id,
                  itemDetails: item,
                  qtyPerUnit: qty,
                });
              }
            });
            return newComponents;
          });

          setIsMultiSelectItemModalOpen(false);
          setMultiSelectTargetIndex(null);
        }}
      />
"""

for f in files:
    with open(f, 'r') as file:
        content = file.read()
    
    # 1. Add imports
    if 'MultiSelectItemModal' not in content:
        content = content.replace("import { ItemComboBox } from '../../../components/ui/ItemComboBox';", 
                                  "import { ItemComboBox } from '../../../components/ui/ItemComboBox';\n" + import_str)
    
    # 2. Add state variables
    if 'isMultiSelectItemModalOpen' not in content:
        content = content.replace("const [components, setComponents] = useState<ComponentRow[]>([]);",
                                  "const [components, setComponents] = useState<ComponentRow[]>([]);\n" + state_str)
    
    # 3. Update ItemComboBox
    if 'onOpenMultiSelect' not in content:
        content = re.sub(
            r"(<ItemComboBox\s*orgId=\{orgId!\}\s*value=\{comp\.componentItemId \|\| ''\}\s*onChange=\{[^\}]+\}\s*)",
            r"\1" + on_open_multi_select,
            content
        )
    
    # 4. Insert Modal before closing </div> of the page
    if '<MultiSelectItemModal' not in content:
        # We will insert it just before the UomFormModal
        content = content.replace("<UomFormModal", modal_str + "\n      <UomFormModal")

    with open(f, 'w') as file:
        file.write(content)

print('MultiSelectItemModal integrated successfully.')
