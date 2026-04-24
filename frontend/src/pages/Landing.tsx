import { useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';

export default function Landing() {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); }),
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
    );
    document.querySelectorAll('.fade-up').forEach(el => observerRef.current?.observe(el));
    return () => observerRef.current?.disconnect();
  }, []);

  const features = [
    { icon: '👥', title: 'Member Management', desc: 'Register, track and manage all your gym members — individual, institutional and dependents — in one place.' },
    { icon: '✅', title: 'Smart Check-in', desc: 'OTP-based QR check-in with service selection, MoMo payment and instant SMS notifications.' },
    { icon: '🏢', title: 'Corporate Billing', desc: 'Automated invoicing for companies. HR portal, employee tracking, and MoMo payment collection.' },
    { icon: '📊', title: 'Reports & Analytics', desc: 'Attendance reports, billing breakdowns, membership stats, and PDF exports at your fingertips.' },
    { icon: '🤖', title: 'AI Business Analyst', desc: 'Built-in AI answers questions about your revenue, members and performance using live data.' },
    { icon: '💳', title: 'MTN MoMo Payments', desc: 'Collect payments directly via MTN Mobile Money. No cash handling, no manual follow-ups.' },
  ];

  const steps = [
    { n: '01', title: 'Create Your Gym', desc: 'Sign up in 2 minutes. Add your gym name, services, and membership plans.' },
    { n: '02', title: 'Add Your Members', desc: 'Import members via Excel or let them self-register at check-in with a phone number.' },
    { n: '03', title: 'Start Managing', desc: 'Track attendance, send invoices, collect payments and grow your business.' },
  ];

  const stats = [
    { value: '24/7', label: 'System Uptime' },
    { value: '100%', label: 'Made in Rwanda' },
    { value: 'AI', label: 'Powered Analytics' },
    { value: 'Free', label: '3-Month Trial' },
  ];

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", background: '#050f09', color: '#f0faf5', overflowX: 'hidden' }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />

      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        :root{
          --g900:#052e1c;--g800:#0a4a2e;--g700:#0d6640;--g600:#0F6E56;--g500:#1a9b7a;--g400:#22c997;--g300:#6edbb8;
          --gold:#d4a853;--dark:#050f09;--border:rgba(110,219,184,0.12);--card:rgba(10,74,46,0.2);
        }
        html{scroll-behavior:smooth}
        .fade-up{opacity:0;transform:translateY(32px);transition:opacity 0.7s ease,transform 0.7s ease}
        .fade-up.visible{opacity:1;transform:translateY(0)}
        .fade-up:nth-child(2){transition-delay:0.1s}
        .fade-up:nth-child(3){transition-delay:0.2s}
        .fade-up:nth-child(4){transition-delay:0.3s}
        .fade-up:nth-child(5){transition-delay:0.4s}
        .fade-up:nth-child(6){transition-delay:0.5s}
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}
        @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.5;transform:scale(0.8)}}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @keyframes grain{0%,100%{transform:translate(0,0)}25%{transform:translate(-2%,-1%)}50%{transform:translate(1%,2%)}75%{transform:translate(-1%,1%)}}
      `}</style>

      {/* GRAIN OVERLAY */}
      <div style={{position:'fixed',inset:0,backgroundImage:'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 512 512\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\' opacity=\'0.04\'/%3E%3C/svg%3E")',pointerEvents:'none',zIndex:0,opacity:0.5,animation:'grain 8s steps(1) infinite'}} />

      {/* NAVBAR */}
      <nav style={{position:'fixed',top:0,left:0,right:0,zIndex:100,display:'flex',alignItems:'center',justifyContent:'space-between',padding:'18px 60px',background:scrolled?'rgba(5,15,9,0.85)':'transparent',backdropFilter:scrolled?'blur(20px)':'none',borderBottom:scrolled?'1px solid var(--border)':'none',transition:'all 0.3s'}}>
        <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
          <div style={{width:'36px',height:'36px',background:'var(--g600)',borderRadius:'10px',display:'flex',alignItems:'center',justifyContent:'center'}}>
            <svg width="20" height="20" viewBox="0 0 64 64" fill="none"><line x1="18" y1="32" x2="46" y2="32" stroke="white" strokeWidth="4" strokeLinecap="round"/><rect x="12" y="24" width="7" height="16" rx="3" fill="white"/><rect x="45" y="24" width="7" height="16" rx="3" fill="white"/></svg>
          </div>
          <span style={{fontFamily:'Playfair Display,serif',fontSize:'20px',fontWeight:700,color:'var(--g400)'}}>GymMind</span>
        </div>
        <div style={{display:'flex',gap:'32px',listStyle:'none'}} className="nav-links">
          {['Features','How it Works','Pricing','Contact'].map(l => (
            <a key={l} href={`#${l.toLowerCase().replace(/ /g,'-')}`} style={{color:'rgba(240,250,245,0.65)',textDecoration:'none',fontSize:'13px',fontWeight:500,letterSpacing:'0.5px',transition:'color 0.2s'}}
              onMouseEnter={e=>(e.target as HTMLElement).style.color='var(--g400)'}
              onMouseLeave={e=>(e.target as HTMLElement).style.color='rgba(240,250,245,0.65)'}>{l}</a>
          ))}
        </div>
        <div style={{display:'flex',gap:'12px'}}>
          <button onClick={() => navigate('/login')} style={{background:'transparent',color:'var(--g300)',border:'1px solid var(--border)',borderRadius:'100px',padding:'8px 20px',fontSize:'13px',fontWeight:600,cursor:'pointer',transition:'all 0.2s'}}
            onMouseEnter={e=>{(e.target as HTMLElement).style.borderColor='var(--g400)';(e.target as HTMLElement).style.color='var(--g400)'}}
            onMouseLeave={e=>{(e.target as HTMLElement).style.borderColor='var(--border)';(e.target as HTMLElement).style.color='var(--g300)'}}>
            Login
          </button>
          <button onClick={() => navigate('/signup')} style={{background:'linear-gradient(135deg,var(--g600),var(--g500))',color:'#fff',border:'none',borderRadius:'100px',padding:'8px 20px',fontSize:'13px',fontWeight:600,cursor:'pointer',boxShadow:'0 4px 20px rgba(15,110,86,0.4)',transition:'all 0.2s'}}
            onMouseEnter={e=>(e.target as HTMLElement).style.transform='translateY(-1px)'}
            onMouseLeave={e=>(e.target as HTMLElement).style.transform='translateY(0)'}>
            Start Free →
          </button>
        </div>
      </nav>

      {/* HERO */}
      <section style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',padding:'120px 60px 80px',position:'relative',zIndex:1}}>
        <div style={{position:'absolute',inset:0,background:'radial-gradient(ellipse 80% 60% at 50% 30%,rgba(15,110,86,0.2) 0%,transparent 70%)',pointerEvents:'none'}} />
        <div style={{maxWidth:'900px',textAlign:'center',position:'relative'}}>
          <div style={{display:'inline-flex',alignItems:'center',gap:'8px',background:'rgba(26,155,122,0.12)',border:'1px solid rgba(26,155,122,0.25)',borderRadius:'100px',padding:'6px 16px',fontSize:'12px',fontWeight:600,color:'var(--g400)',letterSpacing:'1px',textTransform:'uppercase',marginBottom:'28px'}}>
            <span style={{width:'6px',height:'6px',background:'var(--g400)',borderRadius:'50%',animation:'pulse 2s infinite'}} />
            Now live in Rwanda 🇷🇼
          </div>
          <h1 style={{fontFamily:'Playfair Display,serif',fontSize:'clamp(48px,7vw,88px)',fontWeight:900,lineHeight:1.05,letterSpacing:'-3px',marginBottom:'24px',background:'linear-gradient(135deg,#fff 0%,var(--g300) 50%,var(--g400) 100%)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',backgroundClip:'text'}}>
            Manage Your Gym<br/>Like a Pro
          </h1>
          <p style={{fontSize:'18px',color:'rgba(240,250,245,0.65)',lineHeight:1.75,maxWidth:'600px',margin:'0 auto 40px'}}>
            GymMind is the all-in-one gym management platform built for Rwanda. Members, billing, attendance, HR portals — all in one place, powered by AI.
          </p>
          <div style={{display:'flex',gap:'16px',justifyContent:'center',flexWrap:'wrap',marginBottom:'64px'}}>
            <button onClick={() => navigate('/signup')} style={{display:'inline-flex',alignItems:'center',gap:'8px',background:'linear-gradient(135deg,var(--g600),var(--g500))',color:'#fff',border:'none',borderRadius:'100px',padding:'16px 32px',fontSize:'16px',fontWeight:600,cursor:'pointer',boxShadow:'0 8px 32px rgba(15,110,86,0.5)',transition:'all 0.3s'}}
              onMouseEnter={e=>{(e.target as HTMLElement).style.transform='translateY(-2px)';(e.target as HTMLElement).style.boxShadow='0 16px 48px rgba(15,110,86,0.6)'}}
              onMouseLeave={e=>{(e.target as HTMLElement).style.transform='translateY(0)';(e.target as HTMLElement).style.boxShadow='0 8px 32px rgba(15,110,86,0.5)'}}>
              🚀 Start Free Trial
            </button>
            <button onClick={() => navigate('/login')} style={{display:'inline-flex',alignItems:'center',gap:'8px',background:'transparent',color:'var(--g300)',border:'1px solid rgba(110,219,184,0.2)',borderRadius:'100px',padding:'16px 32px',fontSize:'16px',fontWeight:600,cursor:'pointer',transition:'all 0.3s'}}
              onMouseEnter={e=>{(e.target as HTMLElement).style.borderColor='var(--g400)';(e.target as HTMLElement).style.color='var(--g400)'}}
              onMouseLeave={e=>{(e.target as HTMLElement).style.borderColor='rgba(110,219,184,0.2)';(e.target as HTMLElement).style.color='var(--g300)'}}>
              Login to my gym →
            </button>
          </div>

          {/* Stats row */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'16px',maxWidth:'700px',margin:'0 auto'}}>
            {stats.map(st => (
              <div key={st.value} style={{background:'var(--card)',border:'1px solid var(--border)',borderRadius:'16px',padding:'20px 12px',backdropFilter:'blur(10px)'}}>
                <div style={{fontFamily:'Playfair Display,serif',fontSize:'28px',fontWeight:700,color:'var(--g300)',lineHeight:1}}>{st.value}</div>
                <div style={{fontSize:'11px',color:'rgba(240,250,245,0.5)',marginTop:'4px',textTransform:'uppercase',letterSpacing:'0.5px'}}>{st.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" style={{padding:'120px 60px',borderTop:'1px solid var(--border)',position:'relative',zIndex:1}}>
        <div style={{maxWidth:'1140px',margin:'0 auto'}}>
          <div style={{textAlign:'center',marginBottom:'64px'}} className="fade-up">
            <div style={{fontFamily:'DM Mono,monospace',fontSize:'11px',color:'var(--gold)',letterSpacing:'3px',textTransform:'uppercase',marginBottom:'12px'}}>What We Offer</div>
            <h2 style={{fontFamily:'Playfair Display,serif',fontSize:'clamp(32px,4vw,52px)',fontWeight:700,letterSpacing:'-1px',marginBottom:'16px'}}>Everything Your Gym Needs</h2>
            <p style={{color:'rgba(240,250,245,0.6)',fontSize:'16px',maxWidth:'500px',margin:'0 auto'}}>From member check-ins to corporate billing — GymMind handles it all.</p>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'20px'}}>
            {features.map((f) => (
              <div key={f.title} className="fade-up" style={{background:'var(--card)',border:'1px solid var(--border)',borderRadius:'20px',padding:'28px',transition:'all 0.3s',cursor:'default'}}
                onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.borderColor='var(--g600)';(e.currentTarget as HTMLElement).style.transform='translateY(-4px)'}}
                onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.borderColor='var(--border)';(e.currentTarget as HTMLElement).style.transform='translateY(0)'}}>
                <div style={{width:'48px',height:'48px',background:'rgba(15,110,86,0.2)',border:'1px solid rgba(110,219,184,0.15)',borderRadius:'14px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'22px',marginBottom:'16px'}}>{f.icon}</div>
                <div style={{fontWeight:600,fontSize:'16px',marginBottom:'8px'}}>{f.title}</div>
                <div style={{fontSize:'14px',color:'rgba(240,250,245,0.6)',lineHeight:1.6}}>{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" style={{padding:'120px 60px',borderTop:'1px solid var(--border)',position:'relative',zIndex:1}}>
        <div style={{maxWidth:'900px',margin:'0 auto'}}>
          <div style={{textAlign:'center',marginBottom:'64px'}} className="fade-up">
            <div style={{fontFamily:'DM Mono,monospace',fontSize:'11px',color:'var(--gold)',letterSpacing:'3px',textTransform:'uppercase',marginBottom:'12px'}}>Simple Process</div>
            <h2 style={{fontFamily:'Playfair Display,serif',fontSize:'clamp(32px,4vw,52px)',fontWeight:700,letterSpacing:'-1px'}}>Up and Running in Minutes</h2>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'32px'}}>
            {steps.map((st, i) => (
              <div key={st.n} className="fade-up" style={{position:'relative',textAlign:'center',padding:'32px 24px'}}>
                {i < 2 && <div style={{position:'absolute',top:'40px',right:'-16px',width:'32px',height:'1px',background:'linear-gradient(90deg,var(--g600),transparent)'}} />}
                <div style={{fontFamily:'Playfair Display,serif',fontSize:'56px',fontWeight:900,color:'rgba(15,110,86,0.3)',lineHeight:1,marginBottom:'16px'}}>{st.n}</div>
                <div style={{fontWeight:700,fontSize:'18px',marginBottom:'10px'}}>{st.title}</div>
                <div style={{fontSize:'14px',color:'rgba(240,250,245,0.6)',lineHeight:1.6}}>{st.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" style={{padding:'120px 60px',borderTop:'1px solid var(--border)',position:'relative',zIndex:1}}>
        <div style={{maxWidth:'800px',margin:'0 auto',textAlign:'center'}}>
          <div className="fade-up">
            <div style={{fontFamily:'DM Mono,monospace',fontSize:'11px',color:'var(--gold)',letterSpacing:'3px',textTransform:'uppercase',marginBottom:'12px'}}>Pricing</div>
            <h2 style={{fontFamily:'Playfair Display,serif',fontSize:'clamp(32px,4vw,52px)',fontWeight:700,letterSpacing:'-1px',marginBottom:'16px'}}>Start Free. Grow Together.</h2>
            <p style={{color:'rgba(240,250,245,0.6)',fontSize:'16px',marginBottom:'48px'}}>We are new and we want you to experience GymMind before committing. That's why we offer a full 3-month free trial.</p>
          </div>
          <div className="fade-up" style={{background:'var(--card)',border:'1px solid rgba(110,219,184,0.2)',borderRadius:'28px',padding:'48px',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',top:0,left:0,right:0,height:'3px',background:'linear-gradient(90deg,transparent,var(--g400),var(--gold),var(--g400),transparent)'}} />
            <div style={{display:'inline-flex',alignItems:'center',gap:'8px',background:'rgba(26,155,122,0.15)',border:'1px solid rgba(26,155,122,0.3)',borderRadius:'100px',padding:'6px 16px',fontSize:'12px',fontWeight:700,color:'var(--g400)',marginBottom:'20px'}}>
              🎉 FREE TRIAL — 3 MONTHS
            </div>
            <div style={{fontFamily:'Playfair Display,serif',fontSize:'56px',fontWeight:900,color:'var(--g300)',marginBottom:'8px'}}>Free</div>
            <div style={{color:'rgba(240,250,245,0.6)',fontSize:'15px',marginBottom:'32px'}}>No credit card required · Full access to all features</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px',textAlign:'left',marginBottom:'36px'}}>
              {['Unlimited members','Smart check-in system','Corporate billing & HR portal','AI business analytics','MTN MoMo payments','PDF reports & exports','SMS notifications','Priority support'].map(f => (
                <div key={f} style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'14px',color:'rgba(240,250,245,0.8)'}}>
                  <span style={{color:'var(--g400)',fontWeight:700}}>✓</span> {f}
                </div>
              ))}
            </div>
            <button onClick={() => navigate('/signup')} style={{background:'linear-gradient(135deg,var(--g600),var(--g500))',color:'#fff',border:'none',borderRadius:'100px',padding:'16px 48px',fontSize:'16px',fontWeight:600,cursor:'pointer',boxShadow:'0 8px 32px rgba(15,110,86,0.5)',transition:'all 0.3s'}}
              onMouseEnter={e=>(e.target as HTMLElement).style.transform='translateY(-2px)'}
              onMouseLeave={e=>(e.target as HTMLElement).style.transform='translateY(0)'}>
              Get Started Free →
            </button>
          </div>
        </div>
      </section>

      {/* CTA BANNER */}
      <section style={{padding:'80px 60px',position:'relative',zIndex:1}}>
        <div style={{maxWidth:'900px',margin:'0 auto',background:'linear-gradient(135deg,rgba(15,110,86,0.3),rgba(26,155,122,0.15))',border:'1px solid rgba(110,219,184,0.2)',borderRadius:'28px',padding:'64px',textAlign:'center',position:'relative',overflow:'hidden'}}>
          <div style={{position:'absolute',top:0,left:0,right:0,height:'2px',background:'linear-gradient(90deg,transparent,var(--g400),transparent)'}} />
          <h2 className="fade-up" style={{fontFamily:'Playfair Display,serif',fontSize:'clamp(28px,4vw,48px)',fontWeight:700,letterSpacing:'-1px',marginBottom:'16px'}}>Ready to Transform Your Gym?</h2>
          <p className="fade-up" style={{color:'rgba(240,250,245,0.6)',fontSize:'16px',marginBottom:'32px'}}>Join gyms across Rwanda already using GymMind to manage smarter.</p>
          <div className="fade-up" style={{display:'flex',gap:'16px',justifyContent:'center',flexWrap:'wrap'}}>
            <button onClick={() => navigate('/signup')} style={{background:'linear-gradient(135deg,var(--g600),var(--g500))',color:'#fff',border:'none',borderRadius:'100px',padding:'16px 36px',fontSize:'15px',fontWeight:600,cursor:'pointer',boxShadow:'0 8px 32px rgba(15,110,86,0.5)'}}>
              🚀 Start Free Trial
            </button>
            <button onClick={() => navigate('/hr/login')} style={{background:'transparent',color:'var(--g300)',border:'1px solid rgba(110,219,184,0.2)',borderRadius:'100px',padding:'16px 36px',fontSize:'15px',fontWeight:600,cursor:'pointer'}}>
              HR Admin Login →
            </button>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer id="contact" style={{borderTop:'1px solid var(--border)',padding:'48px 60px',position:'relative',zIndex:1}}>
        <div style={{maxWidth:'1140px',margin:'0 auto',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'24px'}}>
          <div>
            <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'8px'}}>
              <div style={{width:'32px',height:'32px',background:'var(--g600)',borderRadius:'8px',display:'flex',alignItems:'center',justifyContent:'center'}}>
                <svg width="18" height="18" viewBox="0 0 64 64" fill="none"><line x1="18" y1="32" x2="46" y2="32" stroke="white" strokeWidth="4" strokeLinecap="round"/><rect x="12" y="24" width="7" height="16" rx="3" fill="white"/><rect x="45" y="24" width="7" height="16" rx="3" fill="white"/></svg>
              </div>
              <span style={{fontFamily:'Playfair Display,serif',fontSize:'18px',fontWeight:700,color:'var(--g400)'}}>GymMind</span>
            </div>
            <p style={{fontSize:'13px',color:'rgba(240,250,245,0.4)'}}>Made with ❤️ in Kigali, Rwanda 🇷🇼</p>
          </div>
          <div style={{display:'flex',gap:'32px',flexWrap:'wrap'}}>
            <a href="mailto:info@gymmind.rw" style={{color:'rgba(240,250,245,0.5)',fontSize:'13px',textDecoration:'none'}}>info@gymmind.rw</a>
            <a href="mailto:support@gymmind.rw" style={{color:'rgba(240,250,245,0.5)',fontSize:'13px',textDecoration:'none'}}>support@gymmind.rw</a>
            <a href="/login" style={{color:'rgba(240,250,245,0.5)',fontSize:'13px',textDecoration:'none'}}>Login</a>
            <a href="/signup" style={{color:'rgba(240,250,245,0.5)',fontSize:'13px',textDecoration:'none'}}>Sign Up</a>
            <a href="/hr/login" style={{color:'rgba(240,250,245,0.5)',fontSize:'13px',textDecoration:'none'}}>HR Portal</a>
          </div>
          <p style={{fontSize:'12px',color:'rgba(240,250,245,0.3)'}}>© 2026 GymMind. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
