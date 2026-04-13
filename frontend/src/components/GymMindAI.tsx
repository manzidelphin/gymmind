import { useState, useRef, useEffect } from 'react';
import type { AxiosInstance } from 'axios';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  loading?: boolean;
}

interface Props {
  mode: 'hr' | 'manager';
  context: { institutionId?: number; institutionName?: string; gymSlug?: string; gymName?: string; };
  api: AxiosInstance;
}

export default function GymMindAI({ mode, context, api }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    if (open && messages.length === 0) {
      const greeting = mode === 'hr'
        ? `Hi! I'm your **GymMind AI** assistant for **${context.institutionName || 'your institution'}**.\n\nI can help you understand attendance, billing, employee visits, and more. What would you like to know?`
        : `Hi! I'm your **GymMind AI** business analyst for **${context.gymName || 'your gym'}**.\n\nI can analyze revenue, member activity, institutional billing, and service performance. Ask me anything!`;
      setMessages([{ role: 'assistant', content: greeting }]);
    }
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  async function fetchContext() {
    const data: Record<string, unknown> = {};
    try {
      if (mode === 'hr') {
        const from = new Date(Date.now()-30*86400000).toISOString().slice(0,10);
        const to = new Date().toISOString().slice(0,10);
        const [a, r] = await Promise.allSettled([
          api.get(`/hr/attendance?from=${from}&to=${to}`),
          api.get(`/hr/${context.institutionId}/billing-report?from=${from}&to=${to}`),
        ]);
        if (a.status === 'fulfilled') data.attendance = a.value.data;
        if (r.status === 'fulfilled') data.billingReport = r.value.data;
      } else {
        const [m, b] = await Promise.allSettled([
          api.get('/members?limit=100'),
          api.get('/billing/summary'),
        ]);
        if (m.status === 'fulfilled') data.members = m.value.data;
        if (b.status === 'fulfilled') data.billing = b.value.data;
      }
    } catch { /* ignore */ }
    return data;
  }

  async function send() {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }, { role: 'assistant', content: '', loading: true }]);
    setLoading(true);
    try {
      const liveData = await fetchContext();
      const sys = mode === 'hr'
        ? `You are GymMind AI, an HR assistant for ${context.institutionName}.\nLIVE DATA:\n${JSON.stringify(liveData)}\nBe concise, professional. Format RWF with commas. Use markdown bold/bullets.`
        : `You are GymMind AI, a business analyst for gym ${context.gymName}.\nLIVE DATA:\n${JSON.stringify(liveData)}\nBe concise, data-driven. Format RWF with commas. Use markdown bold/bullets.`;
      const history = messages.filter(m => !m.loading && m.content).map(m => ({ role: m.role, content: m.content }));
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, system: sys, messages: [...history, { role: 'user', content: userMsg }] }),
      });
      const d = await res.json();
      const reply = d.content?.[0]?.text || 'Sorry, I could not process that.';
      setMessages(prev => prev.map((m, i) => i === prev.length-1 ? { ...m, content: reply, loading: false } : m));
    } catch {
      setMessages(prev => prev.map((m, i) => i === prev.length-1 ? { ...m, content: 'Something went wrong. Please try again.', loading: false } : m));
    } finally { setLoading(false); }
  }

  function md(text: string) {
    return text.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\*(.*?)\*/g,'<em>$1</em>').replace(/^[•-] (.+)$/gm,'<span style="display:block;padding-left:12px">• $1</span>').replace(/\n/g,'<br/>');
  }

  const suggestions = mode === 'hr'
    ? ['Why is my bill this month?','Who are my most active employees?','Which employees haven\'t visited?','Summarize this month\'s attendance']
    : ['How is revenue this month?','Which institution owes the most?','Which services are underperforming?','Summarize member activity'];

  return (
    <>
      <style>{`
        @keyframes gmSlideUp{from{opacity:0;transform:translateY(20px) scale(0.96)}to{opacity:1;transform:translateY(0) scale(1)}}
        @keyframes gmPulse{0%,100%{opacity:1}50%{opacity:0.3}}
        @keyframes gmGlow{0%,100%{box-shadow:0 8px 32px rgba(15,110,86,0.4)}50%{box-shadow:0 8px 40px rgba(15,110,86,0.7)}}
        .gm-msg strong{font-weight:700;color:#0f172a}.gm-msg em{font-style:italic}
        .gm-sugg:hover{background:#f0fdf4!important;border-color:#0F6E56!important;color:#0F6E56!important}
        .gm-send:not(:disabled):hover{transform:scale(1.05)}
        .gm-fab:hover{transform:scale(1.08)!important}
      `}</style>

      {/* Floating Button */}
      <button className="gm-fab" onClick={() => setOpen(o=>!o)} style={{
        position:'fixed',bottom:'28px',right:'28px',width:'62px',height:'62px',
        borderRadius:'50%',background:'linear-gradient(135deg,#0F6E56,#1a9b7a)',
        border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',
        zIndex:9999,transition:'all 0.3s cubic-bezier(0.4,0,0.2,1)',
        boxShadow:'0 8px 32px rgba(15,110,86,0.4)',
        animation:'gmGlow 3s ease-in-out infinite',
      }}>
        {open
          ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="white" strokeWidth="2.5" strokeLinecap="round"/></svg>
          : <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
              <path d="M5 10h20M5 15h14M5 20h10" stroke="white" strokeWidth="2.2" strokeLinecap="round"/>
              <circle cx="24" cy="7" r="5" fill="#34d399"/>
              <text x="24" y="10.5" textAnchor="middle" fontSize="6.5" fill="white" fontWeight="800">AI</text>
            </svg>
        }
      </button>

      {/* Chat Panel */}
      {open && (
        <div style={{
          position:'fixed',bottom:'104px',right:'28px',width:'420px',height:'580px',
          background:'#fff',borderRadius:'24px',boxShadow:'0 24px 80px rgba(0,0,0,0.18)',
          display:'flex',flexDirection:'column',zIndex:9998,overflow:'hidden',
          border:'1px solid rgba(15,110,86,0.1)',animation:'gmSlideUp 0.3s cubic-bezier(0.4,0,0.2,1)',
        }}>
          {/* Header */}
          <div style={{background:'linear-gradient(135deg,#0F6E56 0%,#1a9b7a 100%)',padding:'18px 20px',display:'flex',alignItems:'center',gap:'12px'}}>
            <div style={{width:'44px',height:'44px',background:'rgba(255,255,255,0.15)',borderRadius:'14px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'22px',backdropFilter:'blur(10px)'}}>🤖</div>
            <div style={{flex:1}}>
              <div style={{color:'#fff',fontWeight:800,fontSize:'16px',letterSpacing:'-0.3px'}}>GymMind AI</div>
              <div style={{color:'rgba(255,255,255,0.7)',fontSize:'12px',marginTop:'1px'}}>
                {mode==='hr' ? `HR Assistant · ${context.institutionName||''}` : `Business Analyst · ${context.gymName||''}`}
              </div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:'6px',background:'rgba(255,255,255,0.1)',padding:'5px 10px',borderRadius:'20px'}}>
              <div style={{width:'7px',height:'7px',borderRadius:'50%',background:'#34d399',boxShadow:'0 0 8px #34d399'}}/>
              <span style={{color:'rgba(255,255,255,0.85)',fontSize:'11px',fontWeight:600}}>Live</span>
            </div>
          </div>

          {/* Messages */}
          <div style={{flex:1,overflowY:'auto',padding:'16px',display:'flex',flexDirection:'column',gap:'14px',background:'#f8fafc'}}>
            {messages.map((msg,i) => (
              <div key={i} style={{display:'flex',justifyContent:msg.role==='user'?'flex-end':'flex-start',gap:'8px',alignItems:'flex-end'}}>
                {msg.role==='assistant' && (
                  <div style={{width:'30px',height:'30px',borderRadius:'10px',background:'linear-gradient(135deg,#0F6E56,#1a9b7a)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'15px',flexShrink:0}}>🤖</div>
                )}
                <div style={{
                  maxWidth:'78%',padding:'11px 15px',
                  borderRadius:msg.role==='user'?'20px 20px 4px 20px':'20px 20px 20px 4px',
                  background:msg.role==='user'?'linear-gradient(135deg,#0F6E56,#1a9b7a)':'#fff',
                  color:msg.role==='user'?'#fff':'#374151',fontSize:'13.5px',lineHeight:'1.65',
                  boxShadow:msg.role==='user'?'0 4px 12px rgba(15,110,86,0.3)':'0 2px 8px rgba(0,0,0,0.07)',
                  border:msg.role==='assistant'?'1px solid #e5e7eb':'none',
                }}>
                  {msg.loading
                    ? <div style={{display:'flex',gap:'5px',padding:'2px 0'}}>
                        {[0,1,2].map(j=><div key={j} style={{width:'8px',height:'8px',borderRadius:'50%',background:'#0F6E56',animation:`gmPulse 1.2s ease-in-out ${j*0.2}s infinite`}}/>)}
                      </div>
                    : <div className="gm-msg" dangerouslySetInnerHTML={{__html:md(msg.content)}}/>
                  }
                </div>
              </div>
            ))}
            {/* Suggestions */}
            {messages.length<=1 && (
              <div style={{display:'flex',flexDirection:'column',gap:'6px',marginTop:'4px'}}>
                <div style={{fontSize:'10.5px',color:'#94a3b8',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.6px',marginLeft:'38px'}}>Try asking</div>
                {suggestions.map((s,i)=>(
                  <button key={i} className="gm-sugg" onClick={()=>{setInput(s);inputRef.current?.focus();}} style={{
                    marginLeft:'38px',background:'#fff',border:'1.5px solid #e2e8f0',borderRadius:'12px',
                    padding:'9px 14px',fontSize:'12.5px',color:'#475569',cursor:'pointer',
                    textAlign:'left',fontWeight:500,transition:'all 0.15s',
                  }}>
                    <span style={{marginRight:'6px'}}>💬</span>{s}
                  </button>
                ))}
              </div>
            )}
            <div ref={bottomRef}/>
          </div>

          {/* Input Area */}
          <div style={{padding:'12px 16px',background:'#fff',borderTop:'1px solid #f1f5f9',display:'flex',gap:'8px',alignItems:'center'}}>
            <input ref={inputRef} value={input} onChange={e=>setInput(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&!e.shiftKey&&send()}
              placeholder="Ask anything about your data..." disabled={loading}
              style={{flex:1,padding:'11px 15px',border:'1.5px solid #e2e8f0',borderRadius:'14px',fontSize:'13.5px',outline:'none',color:'#0f172a',transition:'border-color 0.2s'}}
              onFocus={e=>e.target.style.borderColor='#0F6E56'}
              onBlur={e=>e.target.style.borderColor='#e2e8f0'}
            />
            <button className="gm-send" onClick={send} disabled={loading||!input.trim()} style={{
              width:'42px',height:'42px',borderRadius:'13px',transition:'all 0.2s',
              background:loading||!input.trim()?'#f1f5f9':'linear-gradient(135deg,#0F6E56,#1a9b7a)',
              border:'none',cursor:loading||!input.trim()?'not-allowed':'pointer',
              display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M22 2L11 13M22 2L15 22L11 13M11 13L2 9L22 2" stroke={loading||!input.trim()?'#94a3b8':'white'} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
          <div style={{padding:'5px 16px 8px',background:'#fff',textAlign:'center',fontSize:'10px',color:'#cbd5e1',borderTop:'1px solid #f8fafc'}}>
            Powered by Claude AI · GymMind Intelligence
          </div>
        </div>
      )}
    </>
  );
}
