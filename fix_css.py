import re

with open('/home/kasej/Desktop/inviteonly-updates/frontend/style.css', 'r') as f:
    css = f.read()

# Fix 1: Add translateZ(0) to backdrop-filter (except the commented ones)
css = re.sub(r'(\s*backdrop-filter:\s*blur\([^)]+\);(?!\s*removed))', r'\1\n  transform: translateZ(0);\n  will-change: transform;', css)

# Fix 2 & 3: Change .btn transition to all
css = re.sub(r'(transition:\s*background-color[^;]+;)', r'transition: all var(--transition-fast);', css)

# Fix 3: Change background: to background-color: in .btn-* classes is not needed if we change transition to 'all'. 
# Let's also ensure `.card` transition includes box-shadow if it doesn't already, but .card had:
# transition: transform var(--transition-normal), border-color var(--transition-normal), box-shadow var(--transition-normal);
# which is fine.

with open('/home/kasej/Desktop/inviteonly-updates/frontend/style.css', 'w') as f:
    f.write(css)
print("CSS patched.")
