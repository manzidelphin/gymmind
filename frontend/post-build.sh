#!/bin/bash
# GymMind Post-Build Patch Script
# Run: cd frontend && npm run build && bash post-build.sh && pm2 restart gymmind-backend --update-env
set -e
echo "Running GymMind post-build patches..."
DIST=/var/www/gymmind/frontend/dist
PUBLIC=/var/www/gymmind/frontend/public

# Copy static files
cp $PUBLIC/gymmind-ai.js $DIST/gymmind-ai.js
cp $PUBLIC/checkin.html $DIST/checkin.html

# Add AI script tag to index.html
if ! grep -q "gymmind-ai.js" $DIST/index.html; then
  sed -i 's|</body>|<script src="/gymmind-ai.js"></script>\n  </body>|' $DIST/index.html
  echo "Added gymmind-ai.js to index.html"
fi

# DB migration
mysql gymmind -e "ALTER TABLE institutional_payments MODIFY status ENUM('pending','paid','overdue','sent') DEFAULT 'pending';" 2>/dev/null || true

python3 << 'PYEOF'
import re

# ── hr.js patches ──────────────────────────────────────────────
with open('/var/www/gymmind/backend/dist/routes/hr.js') as f: c = f.read()
c = re.sub(r'WHERE i\.slug = \? LIMIT 1', 'WHERE i.id = ? LIMIT 1', c)
c = c.replace("AND u.role = 'member' AND u.parent_id IS NULL", "AND u.role = 'member'")
c = c.replace('SELECT status, paid_at, payment_reference, total_amount FROM institutional_payments',
              'SELECT status, paid_at, total_amount FROM institutional_payments')

# Fix resolveInstitution to accept numeric ID
if "if (/^\\d+$/.test(String(token)))" not in c:
    c = c.replace('async function resolveInstitution(token) {',
    """async function resolveInstitution(token) {
    if (/^\\d+$/.test(String(token))) {
        const instId = parseInt(token);
        const [rows] = await db_1.pool.query('SELECT i.id AS institution_id, i.gym_id, i.name AS institution_name, i.rate_per_session FROM institutions i WHERE i.id=?', [instId]);
        if (rows[0]) return {institutionId:rows[0].institution_id,gymId:rows[0].gym_id,institutionName:rows[0].institution_name,ratePerSession:rows[0].rate_per_session};
    }""")
    print('Fixed resolveInstitution!')

if 'ai-chat' not in c:
    c = c.replace('exports.default = router;', """
router.get('/:token/checkins', async (req, res) => {
    const token=req.params.token;const from=req.query.from||new Date().toISOString().slice(0,7)+'-01';const to=req.query.to||new Date().toISOString().slice(0,10);const search=req.query.search||'';
    try{const inst=await resolveInstitution(token);if(!inst){res.status(404).json({error:'Portal not found'});return;}
    let sql="SELECT c.id,u.name AS employee_name,u.phone,g.name AS gym_name,DATE(c.checked_in_at) AS date,TIME(c.checked_in_at) AS time,c.checked_in_at,c.checkin_type,u.id AS employee_id,p.name AS parent_name,s.name AS service_name FROM checkins c JOIN users u ON u.id=c.user_id JOIN gyms g ON g.id=c.gym_id LEFT JOIN users p ON p.id=u.parent_id LEFT JOIN services s ON s.id=c.service_id WHERE u.institution_id=? AND c.gym_id=? AND DATE(c.checked_in_at) BETWEEN ? AND ?";
    const params=[inst.institutionId,inst.gymId,from,to];
    if(String(search).trim()){sql+=" AND (u.name LIKE ? OR u.phone LIKE ?)";params.push('%'+search+'%','%'+search+'%');}
    sql+=" ORDER BY c.checked_in_at DESC LIMIT 500";
    const [rows]=await db_1.pool.query(sql,params);
    const unique=new Set(rows.map(r=>r.employee_name)).size;
    const ma=rows.reduce((a,r)=>{a[r.employee_name]=(a[r.employee_name]||0)+1;return a;},{});
    res.json({records:rows,attendance:rows,total:rows.length,uniqueEmployees:unique,mostActive:Object.entries(ma).sort((a,b)=>b[1]-a[1])[0]?.[0]||null,lastCheckin:rows[0]?rows[0].checked_in_at:null});
    }catch(e){res.status(500).json({error:'Failed'});}
});
router.get('/:token/billing-report', async (req, res) => {
    const token=req.params.token;const from=req.query.from||new Date(Date.now()-30*86400000).toISOString().slice(0,10);const to=req.query.to||new Date().toISOString().slice(0,10);
    try{const inst=await resolveInstitution(token);if(!inst){res.status(404).json({error:'Portal not found'});return;}
    const [instRows]=await db_1.pool.query('SELECT id,name,rate_per_session FROM institutions WHERE id=? AND gym_id=?',[inst.institutionId,inst.gymId]);
    if(!instRows[0]){res.status(404).json({error:'Not found'});return;}
    const rate=Number(instRows[0].rate_per_session);
    const [rows]=await db_1.pool.query('SELECT u.id,u.name,u.parent_id,p.name AS parent_name,COUNT(c.id) AS visit_count,SUM(COALESCE(s.walkin_price,?)) AS total_amount,GROUP_CONCAT(DATE_FORMAT(c.checked_in_at,"%Y-%m-%d %H:%i") ORDER BY c.checked_in_at SEPARATOR ",") AS visit_dates FROM users u LEFT JOIN users p ON p.id=u.parent_id AND p.gym_id=u.gym_id LEFT JOIN checkins c ON c.user_id=u.id AND c.gym_id=u.gym_id AND DATE(c.checked_in_at) BETWEEN ? AND ? LEFT JOIN services s ON s.id=c.service_id WHERE u.gym_id=? AND u.institution_id=? AND u.role="member" GROUP BY u.id ORDER BY u.name',[rate,from,to,inst.gymId,inst.institutionId]);
    const totalAmount=rows.reduce((s,r)=>s+Number(r.total_amount||0),0);
    const totalVisits=rows.reduce((s,r)=>s+Number(r.visit_count),0);
    res.json({institution:{id:instRows[0].id,name:instRows[0].name,rate_per_session:rate},from,to,members:rows.map(r=>({id:r.id,name:r.name,parent_name:r.parent_name??null,visit_count:Number(r.visit_count),amount_due:Number(r.total_amount||0),visit_dates:r.visit_dates?r.visit_dates.split(','):[]})),total_visits:totalVisits,total_amount:totalAmount});
    }catch(e){res.status(500).json({error:'Failed'});}
});
router.post('/ai-chat', async (req, res) => {
    const auth=req.headers.authorization;if(!auth?.startsWith('Bearer ')){res.status(401).json({error:'Not authenticated'});return;}
    try{const{messages,systemPrompt}=req.body;const https=require('https');
    const geminiKey='AIzaSyBDC3xqs4NIRKMgKR4avMYEdKWR3XzzIkQ';
    const prompt=(systemPrompt||'')+'\n\n'+(messages||[]).map(m=>m.role+': '+m.content).join('\n');
    const bodyStr=JSON.stringify({contents:[{parts:[{text:prompt}]}]});
    const options={hostname:'generativelanguage.googleapis.com',path:'/v1beta/models/gemma-3-4b-it:generateContent?key='+geminiKey,method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(bodyStr)}};
    const apiReq=https.request(options,(apiRes)=>{let data='';apiRes.on('data',c=>data+=c);apiRes.on('end',()=>{try{const p=JSON.parse(data);const text=p?.candidates?.[0]?.content?.parts?.[0]?.text||JSON.stringify(p);res.json({content:[{text}]});}catch(e){res.status(500).json({error:'Parse error'});}});});
    apiReq.on('error',e=>res.status(500).json({error:e.message}));apiReq.write(bodyStr);apiReq.end();
    }catch(e){res.status(500).json({error:String(e)});}
});
exports.default = router;""")
    print('Added routes to hr.js!')
open('/var/www/gymmind/backend/dist/routes/hr.js','w').write(c)

# ── institutionalBilling.js patches ────────────────────────────
with open('/var/www/gymmind/backend/dist/routes/institutionalBilling.js') as f: cb = f.read()

# Fix /institutions endpoint subqueries
if 'SELECT COUNT(DISTINCT c2.user_id)' not in cb:
    old = """         COUNT(DISTINCT CASE WHEN c.id IS NOT NULL THEN c.user_id END) AS active_members,
         COUNT(c.id)                                                    AS total_visits,
         SUM(COALESCE(s.walkin_price, i.rate_per_session, 0)) AS calculated_amount,
         ip.id               AS payment_id,
         ip.status           AS payment_status,
         ip.paid_at,
         ip.total_amount     AS paid_amount,
         ip.payment_reference
       FROM institutions i
       LEFT JOIN users u
         ON u.institution_id = i.id AND u.gym_id = i.gym_id
       LEFT JOIN checkins c
         ON c.user_id = u.id AND c.gym_id = i.gym_id
         AND DATE_FORMAT(c.checked_in_at, '%Y-%m') = ?
       LEFT JOIN services s ON s.id = c.service_id
       LEFT JOIN institutional_payments ip
         ON ip.institution_id = i.id AND ip.gym_id = i.gym_id AND ip.month = ?
       WHERE i.gym_id = ?
       GROUP BY i.id, i.name, i.rate_per_session,
                ip.id, ip.status, ip.paid_at, ip.total_amount, ip.payment_reference"""
    new = """         (SELECT COUNT(DISTINCT c2.user_id) FROM checkins c2 JOIN users u2 ON u2.id=c2.user_id WHERE u2.institution_id=i.id AND c2.gym_id=i.gym_id AND DATE_FORMAT(c2.checked_in_at,'%Y-%m')=?) AS active_members,
         (SELECT COUNT(*) FROM checkins c2 JOIN users u2 ON u2.id=c2.user_id WHERE u2.institution_id=i.id AND c2.gym_id=i.gym_id AND DATE_FORMAT(c2.checked_in_at,'%Y-%m')=?) AS total_visits,
         (SELECT SUM(COALESCE(s2.walkin_price,i.rate_per_session,0)) FROM checkins c2 JOIN users u2 ON u2.id=c2.user_id LEFT JOIN services s2 ON s2.id=c2.service_id WHERE u2.institution_id=i.id AND c2.gym_id=i.gym_id AND DATE_FORMAT(c2.checked_in_at,'%Y-%m')=?) AS calculated_amount,
         ip.id AS payment_id, ip.status AS payment_status, ip.paid_at, ip.total_amount AS paid_amount, ip.payment_reference
       FROM institutions i
       LEFT JOIN institutional_payments ip ON ip.institution_id=i.id AND ip.gym_id=i.gym_id AND ip.month=?
       WHERE i.gym_id=?
       GROUP BY i.id, i.name, i.rate_per_session, ip.id, ip.status, ip.paid_at, ip.total_amount, ip.payment_reference"""
    if old in cb:
        cb = cb.replace(old, new)
        cb = cb.replace('[month, month, gymId]','[month, month, month, month, gymId]',1)
        print('Fixed /institutions subquery!')

# Fix response key
cb = cb.replace('res.json({ month, total_due, total_collected, outstanding, invoices });',
                'res.json({ month, total_due, total_collected, outstanding, institutions: invoices });')

# Fix currency column references
cb = cb.replace("'RWF', 'sent'", "'sent'").replace("'RWF', 'pending'", "'pending'").replace("'RWF', 'paid'", "'paid'")
cb = cb.replace(", currency,", ",").replace(", 'RWF',", ",")

# Fix total_visits -> total_checkins in INSERTs
cb = re.sub(r'total_visits\s*=\s*VALUES\(total_visits\)', 'total_checkins = VALUES(total_checkins)', cb)
cb = re.sub(r'\(gym_id, institution_id, month, total_visits,', '(gym_id, institution_id, month, total_checkins,', cb)

# Add try/catch to send-to-hr if missing
if "try {\n    const gymId = req.gym.id;\n    const parsed = sendToHrSchema" not in cb:
    cb = cb.replace(
        "router.post('/send-to-hr', async (req, res) => {\n    const gymId = req.gym.id;",
        "router.post('/send-to-hr', async (req, res) => {\n    try {\n    const gymId = req.gym.id;"
    )

open('/var/www/gymmind/backend/dist/routes/institutionalBilling.js','w').write(cb)
print('All patches done!')
PYEOF

echo "Post-build patches complete!"

# Copy gym images to dist
if [ -d "public/images" ]; then
  mkdir -p dist/images
  cp public/images/*.jpg dist/images/ 2>/dev/null || true
  echo "Copied gym images to dist!"
fi
