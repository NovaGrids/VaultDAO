#!/usr/bin/env python3
import re

with open('src/test.rs', 'r') as f:
    content = f.read()

# Pattern to match InitConfig blocks that are missing expiration_config
# Look for retry_config block followed by closing brace and InitConfig closing brace
pattern = r'(retry_config: RetryConfig \{[^}]*\},)\n(\s+)\};'
replacement = r'\1\n\2expiration_config: ExpirationConfig::default(),\n\2};'

content = re.sub(pattern, replacement, content)

with open('src/test.rs', 'w') as f:
    f.write(content)

print("Fixed test file")
