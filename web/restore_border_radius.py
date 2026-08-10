import re

files = [
    'e:/octfis-project/jobwork-process-webapp/web/src/features/inventory/composite-items/CreateCompositeItemPage.tsx',
    'e:/octfis-project/jobwork-process-webapp/web/src/features/inventory/composite-items/EditCompositeItemPage.tsx'
]

for f in files:
    with open(f, 'r') as file:
        content = file.read()
    
    # Add border radius back
    content = content.replace("borderRadius: 0,", "borderRadius: '4px',")
    
    with open(f, 'w') as file:
        file.write(content)

print('Restored border radius.')
