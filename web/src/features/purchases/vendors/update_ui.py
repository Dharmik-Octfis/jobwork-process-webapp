import sys
import re

file_path = r'e:\octfis-project\jobwork-process-webapp\web\src\features\purchases\vendors\VendorForm.tsx'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Main container
content = content.replace(
    '''<div className="vendor-form-container" style={{ padding: '24px', maxWidth: '1000px', margin: '0 auto', background: '#fff', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>''',
    '''<div className="vendor-form-container" style={{ padding: '16px 24px', maxWidth: '1000px', margin: '0', background: 'transparent' }}>'''
)

# 2. Header margin
content = content.replace(
    '''<div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '32px' }}>''',
    '''<div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>'''
)

content = content.replace(
    '''<h1 style={{ fontSize: '24px', fontWeight: 600, margin: 0 }}>''',
    '''<h1 style={{ fontSize: '20px', fontWeight: 600, margin: 0 }}>'''
)

# 3. Main Form Grid
content = content.replace(
    '''<div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '24px', marginBottom: '24px', alignItems: 'start' }}>''',
    '''<div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', rowGap: '16px', columnGap: '16px', marginBottom: '24px', alignItems: 'center', fontSize: '13px' }}>'''
)

# 4. Other Details Tab Grid
content = content.replace(
    '''<div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '24px' }}>''',
    '''<div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', rowGap: '16px', columnGap: '16px', fontSize: '13px', alignItems: 'center' }}>'''
)

# 5. Address Grid
content = content.replace(
    '''<div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '16px', alignItems: 'start' }}>''',
    '''<div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: '16px', columnGap: '16px', alignItems: 'start', fontSize: '13px' }}>'''
)

# 6. Global style replacements
# Remove paddingTop from labels that are now center-aligned
content = re.sub(r"paddingTop:\s*'8px'", "paddingTop: '0'", content)

# Reduce input padding and add slight styling
content = re.sub(r"padding:\s*'8px'", "padding: '6px 8px', fontSize: '13px'", content)

# Change border color slightly to look cleaner
content = content.replace("border: '1px solid #ccc'", "border: '1px solid #d1d5db'")

# For the textarea, they need alignItems: start but in main grid they are inputs. Wait, the main grid doesn't have textarea. Address grid does.
# Address grid uses alignItems: start, so it's fine.

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Done")
