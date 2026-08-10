import re

files = [
    'e:/octfis-project/jobwork-process-webapp/web/src/features/inventory/composite-items/CreateCompositeItemPage.tsx',
    'e:/octfis-project/jobwork-process-webapp/web/src/features/inventory/composite-items/EditCompositeItemPage.tsx'
]

for f in files:
    with open(f, 'r') as file:
        content = file.read()
    
    # 1. Update Grid columns for input layout
    content = content.replace("gridTemplateColumns: '140px 1fr'", "gridTemplateColumns: '140px 524px'")
    
    # 2. Add height to 100% width inputs, and remove border radius
    # We will only target styling blocks that look like inputs
    content = re.sub(r"(width:\s*'100%',)", r"\1\n                      height: '34px',", content)
    content = content.replace("borderRadius: '4px',", "borderRadius: 0,")
    
    with open(f, 'w') as file:
        file.write(content)

print('Updated files successfully.')
