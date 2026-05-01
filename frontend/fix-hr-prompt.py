import re

# Fix 1: literal newlines in AI chat prompt
with open('/var/www/gymmind/backend/dist/routes/hr.js') as f:
    c = f.read()

c = c.replace(
    "(systemPrompt||'')+'\n\n'+(messages||[]).map(m=>m.role+': '+m.content).join('\n')",
    "(systemPrompt||'')+'\\n\\n'+(messages||[]).map(m=>m.role+': '+m.content).join('\\n')"
)

# Fix 2: billing-report missing service_names and gym_name
old_sql = 'GROUP BY u.id ORDER BY u.name\','
new_sql = 'GROUP BY u.id,g.name ORDER BY u.name\','

old_join = 'LEFT JOIN services s ON s.id=c.service_id WHERE u.gym_id=? AND u.institution_id=? AND u.role="member"'
new_join = 'LEFT JOIN services s ON s.id=c.service_id LEFT JOIN gyms g ON g.id=u.gym_id WHERE u.gym_id=? AND u.institution_id=? AND u.role="member"'

old_select = 'visit_dates FROM users u'
new_select = 'visit_dates,GROUP_CONCAT(DISTINCT s.name SEPARATOR ", ") AS service_names,g.name AS gym_name FROM users u'

old_map = 'visit_dates:r.visit_dates?r.visit_dates.split(\',\'):[]}))'
new_map = 'visit_dates:r.visit_dates?r.visit_dates.split(\',\'):[],service_names:r.service_names??null,gym_name:r.gym_name??null}))'

for old, new in [(old_join, new_join), (old_select, new_select), (old_map, new_map)]:
    if old in c:
        c = c.replace(old, new)
        print(f'Fixed: {old[:40]}...')
    else:
        print(f'Not found: {old[:40]}...')

with open('/var/www/gymmind/backend/dist/routes/hr.js', 'w') as f:
    f.write(c)
print('Done!')
