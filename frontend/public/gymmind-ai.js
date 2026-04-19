(function(){
  function init(){
    if(window.__gmDone||!document.body)return;
    window.__gmDone=1;
    var btn=document.createElement('button');
    btn.id='gm-ai-btn';
    btn.style.cssText='position:fixed;bottom:28px;right:28px;height:52px;padding:0 20px 0 14px;border-radius:50px;background:linear-gradient(135deg,#0F6E56,#1a9b7a);border:none;cursor:pointer;z-index:9999;box-shadow:0 8px 32px rgba(15,110,86,0.45);font-size:14px;display:flex;align-items:center;justify-content:center;gap:8px;transition:all 0.3s;animation:gmPulseBtn 3s ease-in-out infinite;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-weight:700;color:white;letter-spacing:0.3px';
    btn.innerHTML='<span style="font-size:22px">🤖</span><span id="gm-btn-label">Talk to us</span>';
    var panel=document.createElement('div');
    panel.id='gm-ai-panel';
    panel.style.cssText='position:fixed;bottom:104px;right:28px;width:420px;height:560px;background:#fff;border-radius:24px;box-shadow:0 24px 80px rgba(0,0,0,0.18);display:none;flex-direction:column;z-index:9998;overflow:hidden';
    panel.innerHTML='<div style="background:linear-gradient(135deg,#0F6E56,#1a9b7a);padding:18px 20px;display:flex;align-items:center;gap:12px"><span style="font-size:22px">🤖</span><div style="flex:1"><div style="color:#fff;font-weight:800;font-size:16px">GymMind AI</div><div id="gm-sub" style="color:rgba(255,255,255,0.7);font-size:12px">HR Assistant</div></div><div style="display:flex;align-items:center;gap:6px;background:rgba(255,255,255,0.1);padding:4px 10px;border-radius:20px"><div style="width:7px;height:7px;border-radius:50%;background:#34d399"></div><span style="color:rgba(255,255,255,0.85);font-size:11px">Live</span></div></div><div id="gm-msgs" style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;background:#f8fafc"></div><div style="padding:12px 16px;background:#fff;border-top:1px solid #f1f5f9;display:flex;gap:8px"><input id="gm-inp" placeholder="Ask anything about your data..." style="flex:1;padding:11px 15px;border:1.5px solid #e2e8f0;border-radius:14px;font-size:13.5px;outline:none;font-family:inherit"/><button id="gm-go" style="width:42px;height:42px;border-radius:13px;background:linear-gradient(135deg,#0F6E56,#1a9b7a);border:none;cursor:pointer;font-size:18px;color:white">&#9658;</button></div><div style="text-align:center;font-size:10px;color:#cbd5e1;padding:5px;background:#fff">Powered by Claude AI</div>';
    document.body.appendChild(btn);
    document.body.appendChild(panel);
    var open=false,busy=false;
    btn.onclick=function(){
      open=!open;
      panel.style.display=open?'flex':'none';
      btn.innerHTML=open?'<span style="font-size:18px">✕</span>':'<span style="font-size:22px">🤖</span><span id="gm-btn-label">Talk to us</span>';
      if(open&&!window.__gmCtxLoaded){
        window.__gmCtxLoaded=true;
        var isM2=location.pathname.indexOf('/manager')>-1;
        var fr2=new Date(Date.now()-30*86400000).toISOString().slice(0,10);
        var to2=new Date().toISOString().slice(0,10);
        if(isM2){
          var tok2=localStorage.getItem('token');
          var slug2=location.pathname.split('/')[1]||'';
          var h2={'Authorization':'Bearer '+tok2,'Content-Type':'application/json','X-Gym-Slug':slug2};
          Promise.all([
            fetch('/api/billing/institutions?month='+new Date().toISOString().slice(0,7),{headers:h2}).then(function(x){return x.json();}).catch(function(){return null;}),
            fetch('/api/reports/memberships',{headers:h2}).then(function(x){return x.json();}).catch(function(){return null;})
          ]).then(function(rs){window.__gmCtx={billing:rs[0],memberships:rs[1],gymSlug:slug2};});
        } else {
          var tok2=localStorage.getItem('hr_token');
          var h2={'Authorization':'Bearer '+tok2,'Content-Type':'application/json'};
          var id2=window.__hrInstitutionId;
          Promise.all([
            fetch('/api/hr/attendance?from='+fr2+'&to='+to2,{headers:h2}).then(function(x){return x.json();}).catch(function(){return null;}),
            id2?fetch('/api/hr/'+id2+'/billing-report?from='+fr2+'&to='+to2,{headers:h2}).then(function(x){return x.json();}).catch(function(){return null;}):Promise.resolve(null)
          ]).then(function(rs){window.__gmCtx={attendance:rs[0],billing:rs[1]};});
        }
      }
      if(open&&!document.getElementById('gm-msgs').children.length){
        var isManager=location.pathname.indexOf('/manager')>-1;
        var n=window.__hrInstName||'your institution';
        var gn=window.__gymName||'your gym';
        document.getElementById('gm-sub').textContent=isManager?('Business Analyst · '+gn):('HR Assistant · '+n);
        addmsg('assistant',isManager?('Hi! I am your **GymMind AI** business analyst for **'+gn+'**.\n\nI can analyze revenue, member activity, billing, and service performance. Ask me anything!'):('Hi! I am your **GymMind AI** for **'+n+'**.\n\nI can explain your billing, attendance, and employee visits. What would you like to know?'));
      }
      if(open)setTimeout(function(){document.getElementById('gm-inp').focus();},100);
    };
    document.getElementById('gm-inp').addEventListener('keydown',function(e){if(e.key==='Enter')gosend();});
    document.getElementById('gm-go').onclick=gosend;
    function addmsg(r,t,ld){
      var el=document.getElementById('gm-msgs');
      var d=document.createElement('div');
      d.style.cssText='display:flex;justify-content:'+(r==='user'?'flex-end':'flex-start')+';gap:8px;align-items:flex-end';
      var b=document.createElement('div');
      b.style.cssText='max-width:80%;padding:10px 14px;border-radius:'+(r==='user'?'20px 20px 4px 20px':'4px 20px 20px 20px')+';background:'+(r==='user'?'linear-gradient(135deg,#0F6E56,#1a9b7a)':'#fff')+';color:'+(r==='user'?'#fff':'#374151')+';font-size:13.5px;line-height:1.6;'+(r==='assistant'?'border:1px solid #e5e7eb;box-shadow:0 2px 8px rgba(0,0,0,0.06)':'');
      b.innerHTML=ld?'<em style="opacity:0.5">thinking...</em>':t.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');
      d.appendChild(b);el.appendChild(d);el.scrollTop=el.scrollHeight;return b;
    }
    async function gosend(){
      var inp=document.getElementById('gm-inp');
      var t=inp.value.trim();if(!t||busy)return;
      inp.value='';busy=true;document.getElementById('gm-go').disabled=true;
      addmsg('user',t);var lb=addmsg('assistant','',true);
      var ctx={};
      try{
        var isM=location.pathname.indexOf('/manager')>-1;
        var fr=new Date(Date.now()-30*86400000).toISOString().slice(0,10);
        var to=new Date().toISOString().slice(0,10);
        if(isM){
          var tok=localStorage.getItem('token');
          var gymSlug=location.pathname.split('/')[1]||'';
          var h={'Authorization':'Bearer '+tok,'Content-Type':'application/json','X-Gym-Slug':gymSlug};
          var rs=await Promise.all([
            fetch('/api/billing/institutions?month='+new Date().toISOString().slice(0,7),{headers:h}).then(function(x){return x.json();}).catch(function(){return null;}),
            fetch('/api/reports/memberships',{headers:h}).then(function(x){return x.json();}).catch(function(){return null;})
          ]);
          ctx={billing:rs[0],memberships:rs[1]};
        } else {
          var tok=localStorage.getItem('hr_token');
          var h={'Authorization':'Bearer '+tok,'Content-Type':'application/json'};
          var id=window.__hrInstitutionId;
          var rs=await Promise.all([
            fetch('/api/hr/attendance?from='+fr+'&to='+to,{headers:h}).then(function(x){return x.json();}).catch(function(){return null;}),
            id?fetch('/api/hr/'+id+'/billing-report?from='+fr+'&to='+to,{headers:h}).then(function(x){return x.json();}).catch(function(){return null;}):Promise.resolve(null)
          ]);
          ctx={attendance:rs[0],billing:rs[1]};
        }
      }catch(e){}
      try{
        var bubs=Array.from(document.getElementById('gm-msgs').children).slice(0,-1).map(function(d){
          var b=d.querySelector('div');
          var isU=b&&b.style.background.indexOf('0F6E56')>-1;
          return{role:isU?'user':'assistant',content:b?b.innerText:''};
        });
        var res=await fetch('/api/hr/ai-chat',{
          method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+localStorage.getItem('hr_token')},
          body:JSON.stringify({systemPrompt:(location.pathname.indexOf('/manager')>-1
          ? 'You are GymMind AI for gym '+(window.__gymName||'FitLife Kigali')+'. IMPORTANT: Answer ONLY using the LIVE DATA provided. NEVER invent numbers. If data is missing or shows error, say so. LIVE DATA:'+JSON.stringify(ctx)+'. If asked about active members, use memberships.active. If asked about billing, use billing.institutions. Be concise, use **bold** for real numbers only.'
          : ('You are GymMind AI, HR assistant for '+(window.__hrInstName||'MMI')+'. IMPORTANT: Answer ONLY using the LIVE DATA provided. NEVER invent numbers. LIVE DATA:'+JSON.stringify(ctx)+'. Be concise, use **bold** for real numbers only.')),
            messages:bubs.slice(-6).concat([{role:'user',content:t}])})
        });
        var dd=await res.json();
        var rep=(dd.content&&dd.content[0]&&dd.content[0].text)||'Sorry, something went wrong.';
        lb.innerHTML=rep.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');
      }catch(e){lb.innerHTML='Network error. Try again.';}
      busy=false;document.getElementById('gm-go').disabled=false;
    }
  }
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',function(){setTimeout(init,2000);});}
  else{setTimeout(init,2000);}
})();
