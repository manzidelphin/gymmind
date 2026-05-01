import re

with open('/var/www/gymmind/backend/dist/routes/hr.js') as f:
    c = f.read()

# Fix 1: literal newlines in AI chat prompt
c = c.replace(
    "(systemPrompt||'')+'\n\n'+(messages||[]).map(m=>m.role+': '+m.content).join('\n')",
    "(systemPrompt||'')+'\\n\\n'+(messages||[]).map(m=>m.role+': '+m.content).join('\\n')"
)
print('Fixed prompt newlines!')

# Fix 2: amount_due shows 0 for members with no visits
c = c.replace(
    'amount_due:Number(r.total_amount||0)',
    'amount_due:Number(r.visit_count)>0?Number(r.total_amount||0):0'
)
print('Fixed amount_due!')

# Fix 3: service_names split string to array
c = c.replace(
    'service_names:r.service_names??null',
    'service_names:r.service_names?r.service_names.split(\', \'):null'
)
print('Fixed service_names!')

with open('/var/www/gymmind/backend/dist/routes/hr.js', 'w') as f:
    f.write(c)
print('Done!')
