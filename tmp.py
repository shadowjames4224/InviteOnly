import sys

def check_braces(filepath):
    print(f"Checking {filepath}...")
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    stack = []
    lines = content.split('\n')
    
    in_string = False
    string_char = None
    in_multiline_comment = False
    in_singleline_comment = False
    escaped = False
    
    for line_idx, line in enumerate(lines, 1):
        in_singleline_comment = False
        i = 0
        while i < len(line):
            char = line[i]
            
            if escaped:
                escaped = False
                i += 1
                continue
                
            if in_multiline_comment:
                if char == '*' and i + 1 < len(line) and line[i+1] == '/':
                    in_multiline_comment = False
                    i += 2
                else:
                    i += 1
                continue
                
            if in_singleline_comment:
                break
                
            if in_string:
                if char == '\\':
                    escaped = True
                elif char == string_char:
                    in_string = False
                    string_char = None
                i += 1
                continue
                
            # Check comment start
            if char == '/' and i + 1 < len(line):
                if line[i+1] == '/':
                    in_singleline_comment = True
                    break
                elif line[i+1] == '*':
                    in_multiline_comment = True
                    i += 2
                    continue
                    
            # Check string start
            if char in ("'", '"', '`'):
                in_string = True
                string_char = char
                i += 1
                continue
                
            if char == '{':
                stack.append(('{', line_idx, i, line[:i+1]))
            elif char == '}':
                if not stack:
                    print(f"ERROR: Unmatched '}}' at line {line_idx}, column {i}:")
                    print(f"  {line}")
                    return False
                stack.pop()
                
            i += 1
            
    if stack:
        print("ERROR: Unclosed '{' remaining:")
        for brace, line_idx, col, snippet in stack[-5:]:
            print(f"  at line {line_idx}, column {col}: {snippet.strip()}")
        return False
        
    print("No brace syntax errors found!")
    return True

if __name__ == '__main__':
    check_braces('/home/kasej/Desktop/inviteonly-updates/frontend/index.ts')
    check_braces('/home/kasej/Desktop/inviteonly-updates/frontend/profile.ts')
