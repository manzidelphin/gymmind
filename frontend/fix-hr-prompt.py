import re
with open('/var/www/gymmind/backend/dist/routes/hr.js') as f:
    c = f.read()
# Fix literal newlines in the AI chat prompt string
c = c.replace("(systemPrompt||'')+'\n\n'+(messages||[]).map(m=>m.role+': '+m.content).join('\n')",
              "(systemPrompt||'')+'\\n\\n'+(messages||[]).map(m=>m.role+': '+m.content).join('\\n')")
with open('/var/www/gymmind/backend/dist/routes/hr.js', 'w') as f:
    f.write(c)
print('Fixed hr.js prompt newlines!')
