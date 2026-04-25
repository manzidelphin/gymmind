import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';

export default function Landing() {
  const navigate = useNavigate();
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const els = document.querySelectorAll('[data-reveal]');
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          (e.target as HTMLElement).style.opacity = '1';
          (e.target as HTMLElement).style.transform = 'none';
        }
      });
    }, { threshold: 0.08 });
    els.forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  const [lang, setLang] = useState<'en'|'rw'|'sw'|'fr'>('en');
  const T = {
    en: {
      eye:'A product of DELLON · Rwanda 2026',
      h1a:'GYM',h1b:'MANAGE',h1c:'SMARTER.',
      sub:'The all-in-one platform built for Rwandan gyms. Members, billing, attendance, corporate HR, and AI analytics.',
      start:'Start Free Trial',mgr:'Manager Login',hr:'HR Portal',
      s1:'Simple setup',whatInside:"What's inside",featDesc:'Every feature was designed after talking to gym owners in Rwanda. Nothing unnecessary. Everything you need.',s2a:'THREE STEPS',s2b:'TO LAUNCH.',
      t1:'Create Your Gym',d1:'Sign up, add your gym details, set up services and plans. Under 5 minutes.',
      t2:'Add Your Members',d2:'Import from Excel, add manually, or let members self-register at check-in.',
      t3:'Manage and Grow',d3:'Track attendance, collect payments, send invoices and get AI insights.',
      ptitle:'START FREE.',ptitle2:'NO EXCUSES.',
      pdesc:'Full access, no credit card, no commitment. 3 months completely free.',
      trial:'3 MONTHS FREE TRIAL',nocard:'No credit card required',
      cta1:'YOUR GYM',cta2:'DESERVES',cta3:'BETTER.',
      ctad:'Stop managing with WhatsApp and paper. GymMind gives you a real system.',
      tag:'Gym management software built for Rwanda.',
    },
    rw: {
      eye:'Igicuruzwa cya DELLON · Rwanda 2026',
      h1a:'GUCUNGA',h1b:'INGABU',h1c:'NEZA.',
      sub:'Sisitemu yuzuye yo gucunga ingabu zawe. Abanyamuryango, kwishyura, kugenzura, HR — byose hamwe.',
      start:'Tangira Ubuntu',mgr:'Injira Umuyobozi',hr:'Injira HR',
      s1:'Gutangira byoroshye',whatInside:'Ibirimo',featDesc:'Ibiranga byose byakozwe nyuma yo kuganira na ba nyir ingabu mu Rwanda.',s2a:'INTERA EBYIRI',s2b:'KU GUTANGIRA.',
      t1:'Fungura Ingabu Yawe',d1:'Iyandikishe, ongeramo ingabu zawe, shyiramo serivisi. Iminota 5.',
      t2:'Ongeramo Abanyamuryango',d2:'Naka Excel, ongeramo mu buryo bwite, cyangwa biyandikishe ubwabo.',
      t3:'Gucunga no Gutera Imbere',d3:'Genzura ubutabizi, gusaba amafaranga, kohereza fagitire.',
      ptitle:'TANGIRA',ptitle2:'UBUNTU.',
      pdesc:'Ikaze ryuzuye, nta karita ya banki. Amezi 3 ubuntu.',
      trial:'AMEZI 3 UBUNTU',nocard:'Nta karita ya banki isabwa',
      cta1:'INGABU YAWE',cta2:'IKWIRIYE',cta3:'NEZA.',
      ctad:'Hagarika gucunga na WhatsApp. GymMind ikuha sisitemu nyayo.',
      tag:'Sisitemu yo gucunga ingabu mu Rwanda.',
    },
    sw: {
      eye:'Bidhaa ya DELLON · Rwanda 2026',
      h1a:'SIMAMIA',h1b:'GYM',h1c:'KWA AKILI.',
      sub:'Jukwaa kamili lililojengwa kwa gym za Rwanda. Wanachama, malipo, mahudhurio, HR na AI — zote mahali pamoja.',
      start:'Anza Bure',mgr:'Ingia Meneja',hr:'Mlango wa HR',
      s1:'Uanzishaji rahisi',whatInside:'Kilicho Ndani',featDesc:'Kila kipengele kilibuniwa baada ya kuzungumza na wamiliki wa gym nchini Rwanda.',s2a:'HATUA TATU',s2b:'KWA KUANZA.',
      t1:'Unda Gym Yako',d1:'Jisajili, ongeza maelezo ya gym yako, weka huduma na mipango.',
      t2:'Ongeza Wanachama',d2:'Ingiza kutoka Excel, ongeza mwenyewe, au wanachama wajisajili wenyewe.',
      t3:'Simamia na Kukua',d3:'Fuatilia mahudhurio, kusanya malipo, tuma ankara kwa kampuni.',
      ptitle:'ANZA BURE.',ptitle2:'HAPANA UDHURU.',
      pdesc:'Ufikiaji kamili, bila kadi ya benki. Miezi 3 bure kabisa.',
      trial:'MIEZI 3 BURE',nocard:'Hakuna kadi ya benki inayohitajika',
      cta1:'GYM YAKO',cta2:'INASTAHILI',cta3:'ZAIDI.',
      ctad:'Acha kusimamia na WhatsApp. GymMind inakupa mfumo wa kweli.',
      tag:'Programu ya usimamizi wa gym kwa Rwanda.',
    },
    fr: {
      eye:'Un produit de DELLON · Rwanda 2026',
      h1a:'GEREZ',h1b:'VOTRE SALLE',h1c:'MIEUX.',
      sub:'La plateforme tout-en-un pour les salles de sport rwandaises. Membres, facturation, presences, RH et IA.',
      start:'Commencer Gratuitement',mgr:'Connexion Gestionnaire',hr:'Portail RH',
      s1:'Configuration simple',whatInside:'Ce que comprend',featDesc:'Chaque fonctionnalite a ete concue apres avoir discute avec des proprietaires de salles au Rwanda.',s2a:'TROIS ETAPES',s2b:'POUR DEMARRER.',
      t1:'Creez Votre Salle',d1:'Inscrivez-vous, ajoutez les details de votre salle, configurez vos services.',
      t2:'Ajoutez Vos Membres',d2:'Importez depuis Excel, ajoutez manuellement, ou laissez les membres se connecter.',
      t3:'Gerez et Grandissez',d3:'Suivez les presences, collectez les paiements, envoyez des factures.',
      ptitle:'COMMENCEZ',ptitle2:'GRATUITEMENT.',
      pdesc:'Acces complet, sans carte bancaire. 3 mois entierement gratuits.',
      trial:'3 MOIS GRATUITS',nocard:'Aucune carte bancaire requise',
      cta1:'VOTRE SALLE',cta2:'MERITE',cta3:'MIEUX.',
      ctad:'Arretez de gerer avec WhatsApp. GymMind vous donne un vrai systeme.',
      tag:'Logiciel de gestion de salle pour le Rwanda.',
    },
  }[lang];

  const navScrolled = scrollY > 60;

  const features = [
    { icon: '◈', title: 'Member Management', desc: 'Individual, institutional, and dependent members. Full lifecycle tracking with status, plans, and history.' },
    { icon: '⬡', title: 'Smart Check-in', desc: 'QR code + OTP check-in with service selection. New members can register and pay via MoMo on the spot.' },
    { icon: '▣', title: 'Corporate Billing', desc: 'Automated invoicing for companies. HR admins manage employees, view attendance, and pay invoices.' },
    { icon: '◉', title: 'AI Business Analyst', desc: 'Ask your AI about revenue, member trends, and service performance. Real answers from live data.' },
    { icon: '⬢', title: 'MTN MoMo Payments', desc: 'Collect walk-in fees and plan payments directly. USSD prompts sent automatically. No cash hassle.' },
    { icon: '◫', title: 'Reports & Exports', desc: 'Attendance reports, billing breakdowns, subscription summaries. Download as PDF or CSV.' },
  ];

  return (
    <div style={{ background: '#0a0a08', color: '#f5f0e8', fontFamily: "'Space Grotesk', 'Helvetica Neue', sans-serif", overflowX: 'hidden' }}>
      <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Space+Grotesk:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        html{scroll-behavior:smooth}
        ::selection{background:#22c997;color:#0a0a08}
        .nav-link{color:rgba(245,240,232,0.5);text-decoration:none;font-size:13px;font-weight:500;letter-spacing:0.03em;transition:color 0.2s}
        .nav-link:hover{color:#22c997}
        .feat-card{border:1px solid rgba(245,240,232,0.08);padding:32px;transition:border-color 0.3s,background 0.3s;position:relative;overflow:hidden;background:#0a0a08}
        .feat-card::before{content:'';position:absolute;bottom:0;left:0;right:0;height:2px;background:#22c997;transform:scaleX(0);transform-origin:left;transition:transform 0.4s cubic-bezier(0.16,1,0.3,1)}
        .feat-card:hover{border-color:rgba(34,201,151,0.25);background:rgba(34,201,151,0.02)}
        .feat-card:hover::before{transform:scaleX(1)}
        .btn-primary{background:#22c997;color:#0a0a08;border:none;font-weight:700;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;padding:14px 28px;cursor:pointer;transition:all 0.2s;font-family:inherit}
        .btn-primary:hover{background:linear-gradient(135deg,#1a9b7a,#22c997);transform:translateY(-1px)}
        .btn-ghost{background:transparent;color:rgba(245,240,232,0.6);border:1px solid rgba(245,240,232,0.15);font-weight:500;font-size:13px;padding:14px 32px;cursor:pointer;transition:all 0.2s;font-family:inherit;border-radius:100px}
        .btn-ghost:hover{color:#f5f0e8;border-color:rgba(245,240,232,0.4)}
        .ticker-inner{display:flex;gap:48px;animation:ticker 40s linear infinite}
        @keyframes ticker{from{transform:translateX(0)}to{transform:translateX(-50%)}}
        .step-num{font-family:'Bebas Neue',sans-serif;font-size:120px;line-height:0.8;color:rgba(245,240,232,0.04);position:absolute;top:-10px;left:-10px;pointer-events:none;user-select:none}
        .reveal{opacity:0;transform:translateY(40px);transition:opacity 0.8s cubic-bezier(0.16,1,0.3,1),transform 0.8s cubic-bezier(0.16,1,0.3,1)}
        @keyframes fadeUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes slideRight{from{opacity:0;transform:translateX(-30px)}to{opacity:1;transform:translateX(0)}}
        @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.6;transform:scale(0.85)}}
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
        @keyframes borderGlow{0%,100%{box-shadow:0 0 0 0 rgba(34,201,151,0)}50%{box-shadow:0 0 20px 4px rgba(34,201,151,0.3)}}
        .hero-title{animation:fadeUp 1s cubic-bezier(0.16,1,0.3,1) 0.2s both}
        .hero-sub{animation:fadeUp 1s cubic-bezier(0.16,1,0.3,1) 0.4s both}
        .hero-btns{animation:fadeUp 1s cubic-bezier(0.16,1,0.3,1) 0.6s both}
        .hero-card{animation:fadeUp 1s cubic-bezier(0.16,1,0.3,1) 0.5s both}
        .hero-eye{animation:fadeIn 1s cubic-bezier(0.16,1,0.3,1) 0.1s both}
        .stat-card{animation:fadeUp 0.8s cubic-bezier(0.16,1,0.3,1) both}
        .stat-card:nth-child(1){animation-delay:0.1s}
        .stat-card:nth-child(2){animation-delay:0.2s}
        .stat-card:nth-child(3){animation-delay:0.3s}
        .stat-card:nth-child(4){animation-delay:0.4s}
        .feat-card:hover{border-color:rgba(34,201,151,0.3)!important;transform:translateY(-4px)}
        .btn-primary:hover{animation:borderGlow 1s infinite}
        .dot-pulse{animation:pulse 2s infinite}
        .hero-num{animation:float 4s ease-in-out infinite}
        @media(max-width:768px){.hide-mob{display:none!important}.mob-col{grid-template-columns:1fr!important}.mob-2{grid-template-columns:1fr 1fr!important}}
      `}</style>

      {/* NAV */}
      <nav style={{position:'fixed',top:0,left:0,right:0,zIndex:100,display:'flex',alignItems:'center',justifyContent:'space-between',padding:'20px 48px',background:navScrolled?'rgba(10,10,8,0.92)':'transparent',backdropFilter:navScrolled?'blur(16px)':'none',borderBottom:navScrolled?'1px solid rgba(245,240,232,0.06)':'none',transition:'all 0.4s'}}>
        <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
          <div style={{width:'32px',height:'32px',background:'linear-gradient(135deg,#0F6E56,#1a9b7a)',borderRadius:'4px',display:'flex',alignItems:'center',justifyContent:'center'}}>
            <svg width="18" height="18" viewBox="0 0 64 64" fill="none"><line x1="18" y1="32" x2="46" y2="32" stroke="#0a0a08" strokeWidth="5" strokeLinecap="round"/><rect x="12" y="24" width="7" height="16" rx="2" fill="#0a0a08"/><rect x="45" y="24" width="7" height="16" rx="2" fill="#0a0a08"/></svg>
          </div>
          <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:'22px',letterSpacing:'0.05em',color:'#f5f0e8'}}>GymMind</span>
        </div>
        <div className="hide-mob" style={{display:'flex',gap:'36px',alignItems:'center'}}>
          {['Features','How it works','Pricing','Contact'].map(l=>(
            <a key={l} href={`#${l.toLowerCase().replace(/ /g,'-')}`} className="nav-link">{l}</a>
          ))}
        </div>
        <div style={{display:'flex',gap:'10px'}}>
          <div style={{position:'relative'}}>
            <select
              value={lang}
              onChange={e=>setLang(e.target.value as 'en'|'rw'|'sw'|'fr')}
              style={{appearance:'none',WebkitAppearance:'none',background:'rgba(245,240,232,0.06)',border:'1px solid rgba(245,240,232,0.12)',borderRadius:'100px',padding:'8px 36px 8px 16px',fontSize:'12px',fontWeight:600,color:'rgba(245,240,232,0.8)',cursor:'pointer',fontFamily:'inherit',outline:'none',transition:'all 0.2s'}}>
              <option value="en" style={{background:'#0a0a08'}}>🌐 English</option>
              <option value="rw" style={{background:'#0a0a08'}}>🇷🇼 Kinyarwanda</option>
              <option value="sw" style={{background:'#0a0a08'}}>🌍 Swahili</option>
              <option value="fr" style={{background:'#0a0a08'}}>🇫🇷 Français</option>
            </select>
            <span style={{position:'absolute',right:'14px',top:'50%',transform:'translateY(-50%)',color:'rgba(245,240,232,0.5)',fontSize:'10px',pointerEvents:'none'}}>▾</span>
          </div>
          <button className="btn-ghost" onClick={()=>navigate('/login')} style={{borderRadius:'100px',padding:'10px 20px',fontSize:'12px'}}>Login</button>
          <button className="btn-primary" onClick={()=>navigate('/signup')} style={{borderRadius:'100px',padding:'10px 20px',fontSize:'12px'}}>Start Free →</button>
        </div>
      </nav>

      {/* HERO */}
      <section style={{minHeight:'100vh',padding:'140px 48px 80px',position:'relative',display:'flex',alignItems:'center'}}>
        <div style={{position:'absolute',inset:0,backgroundImage:'linear-gradient(rgba(245,240,232,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(245,240,232,0.03) 1px,transparent 1px)',backgroundSize:'80px 80px',zIndex:0}} />
        <div style={{position:'absolute',inset:0,backgroundImage:'url(/images/1i.jpg)',backgroundSize:'cover',backgroundPosition:'center',opacity:0.08,zIndex:0}} />
        <div style={{position:'absolute',top:'15%',right:'5%',width:'480px',height:'480px',background:'radial-gradient(circle,rgba(34,201,151,0.08) 0%,transparent 70%)',pointerEvents:'none',zIndex:0}} />
        <div style={{maxWidth:'1200px',margin:'0 auto',width:'100%',position:'relative',zIndex:1}}>
          <div className="mob-col" style={{display:'grid',gridTemplateColumns:'1fr 400px',gap:'80px',alignItems:'center'}}>
            <div>
              <div className="hero-eye" style={{display:'inline-flex',alignItems:'center',gap:'10px',marginBottom:'32px'}}>
                <div className='dot-pulse' style={{width:'8px',height:'8px',borderRadius:'50%',background:'linear-gradient(135deg,#0F6E56,#1a9b7a)',boxShadow:'0 0 12px #22c997'}} />
                <span style={{fontSize:'11px',fontWeight:600,letterSpacing:'0.15em',textTransform:'uppercase',color:'rgba(245,240,232,0.5)',fontFamily:"'DM Mono',monospace"}}>{T.eye}</span>
              </div>
              <h1 className="hero-title" style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:'clamp(72px,10vw,128px)',lineHeight:'0.92',letterSpacing:'0.01em',marginBottom:'32px'}}>
                <span style={{display:'block',color:'#f5f0e8'}}>{T.h1a}</span>
                <span style={{display:'block',color:'#22c997'}}>{T.h1b}</span>
                <span style={{display:'block',color:'#f5f0e8'}}>{T.h1c}</span>
              </h1>
              <p className="hero-sub" style={{fontSize:'16px',lineHeight:'1.7',color:'rgba(245,240,232,0.55)',maxWidth:'480px',marginBottom:'40px',fontWeight:300}}>
                {T.sub}
              </p>
              <div className="hero-btns" style={{display:'flex',gap:'12px',flexWrap:'wrap'}}>
                <button className="btn-primary" onClick={()=>navigate('/signup')} style={{borderRadius:'100px'}}>{T.start} →</button>
                <button className="btn-ghost" onClick={()=>navigate('/login')} style={{borderRadius:'100px'}}>{T.mgr}</button>
                <button className="btn-ghost" onClick={()=>navigate('/hr/login')} style={{borderRadius:'100px',borderColor:'rgba(34,201,151,0.2)',color:'rgba(34,201,151,0.7)'}}>{T.hr}</button>
              </div>
            </div>
            <div className="hide-mob hero-card" style={{background:'rgba(245,240,232,0.03)',border:'1px solid rgba(245,240,232,0.08)',padding:'32px',position:'relative'}}>
              <div style={{position:'absolute',top:0,left:0,right:0,height:'2px',background:'linear-gradient(90deg,#22c997,transparent)'}} />
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:'10px',color:'rgba(245,240,232,0.3)',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:'20px'}}>Live Dashboard</div>
              {[
                {label:'Active Members',value:'247',change:'+12 this week',up:true},
                {label:'Monthly Revenue',value:'2.4M RWF',change:'+18% vs last month',up:true},
                {label:"Today's Check-ins",value:'34',change:'3 pending approval',up:false},
              ].map(stat=>(
                <div key={stat.label} style={{marginBottom:'20px',paddingBottom:'20px',borderBottom:'1px solid rgba(245,240,232,0.06)'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                    <div>
                      <div style={{fontSize:'11px',color:'rgba(245,240,232,0.4)',marginBottom:'4px',fontFamily:"'DM Mono',monospace"}}>{stat.label}</div>
                      <div style={{fontSize:'26px',fontFamily:"'Bebas Neue',sans-serif",letterSpacing:'0.03em'}}>{stat.value}</div>
                    </div>
                    <span style={{fontSize:'11px',color:stat.up?'#22c997':'rgba(245,240,232,0.3)',background:stat.up?'rgba(34,201,151,0.1)':'rgba(245,240,232,0.05)',padding:'3px 8px'}}>
                      {stat.up?'↑':'→'} {stat.change}
                    </span>
                  </div>
                </div>
              ))}
              <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
                {['Members ✓','Billing ✓','AI ✓','MoMo ✓'].map(t=>(
                  <span key={t} style={{fontSize:'10px',fontFamily:"'DM Mono',monospace",color:'#22c997',background:'rgba(34,201,151,0.08)',padding:'4px 10px',letterSpacing:'0.05em'}}>{t}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TICKER */}
      <div style={{borderTop:'1px solid rgba(245,240,232,0.06)',borderBottom:'1px solid rgba(245,240,232,0.06)',padding:'14px 0',overflow:'hidden',background:'rgba(34,201,151,0.02)'}}>
        <div style={{display:'flex',overflow:'hidden',whiteSpace:'nowrap'}}>
          <div className="ticker-inner">
            {Array(8).fill(['Member Mgmt','Smart Check-in','Corporate Billing','AI Analytics','MTN MoMo','HR Portal','PDF Reports','SMS Alerts']).flat().map((t,i)=>(
              <span key={i} style={{fontSize:'12px',fontFamily:"'DM Mono',monospace",letterSpacing:'0.1em',textTransform:'uppercase',color:'rgba(245,240,232,0.3)'}}>
                {t} <span style={{color:'#22c997',margin:'0 16px'}}>✦</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* STATS */}
      <section style={{padding:'100px 48px',borderBottom:'1px solid rgba(245,240,232,0.06)'}}>
        <div style={{maxWidth:'1200px',margin:'0 auto'}}>
          <div className="mob-2" style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'1px',background:'rgba(245,240,232,0.06)'}}>
            {[
              {num:'24/7',label:'System Uptime',sub:'Always online'},
              {num:'3',label:'Months Free',sub:'No credit card'},
              {num:'AI',label:'Powered',sub:'Live analytics'},
              {num:'🇷🇼',label:'Built for Rwanda',sub:'Local first'},
            ].map(s=>(
              <div key={s.num} className='stat-card' style={{background:'#0a0a08',padding:'48px 32px'}}>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:'clamp(48px,6vw,80px)',lineHeight:'0.9',color:'#22c997'}}>{s.num}</div>
                <div style={{fontSize:'14px',fontWeight:600,color:'#f5f0e8',marginTop:'12px',marginBottom:'4px'}}>{s.label}</div>
                <div style={{fontSize:'12px',color:'rgba(245,240,232,0.35)',fontFamily:"'DM Mono',monospace"}}>{s.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" style={{padding:'120px 48px',position:'relative'}}>
        <div style={{position:'absolute',inset:0,backgroundImage:'url(/images/2i.jpg)',backgroundSize:'cover',backgroundPosition:'center',opacity:0.05,zIndex:0}} />
        <div style={{maxWidth:'1200px',margin:'0 auto'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',marginBottom:'64px',flexWrap:'wrap',gap:'24px'}}>
            <div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:'11px',color:'#22c997',letterSpacing:'0.12em',textTransform:'uppercase',marginBottom:'12px'}}>{T.whatInside}</div>
              <h2 style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:'clamp(40px,5vw,64px)',letterSpacing:'0.02em',lineHeight:0.95}}>BUILT FOR<br/>REAL GYMS.</h2>
            </div>
            <p style={{fontSize:'15px',color:'rgba(245,240,232,0.45)',maxWidth:'380px',lineHeight:'1.7',fontWeight:300}}>{T.featDesc}</p>
          </div>
          <div className="mob-col" style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'1px',background:'rgba(245,240,232,0.06)'}}>
            {features.map(f=>(
              <div key={f.title} className="feat-card">
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:'24px',color:'#22c997',marginBottom:'20px',lineHeight:1}}>{f.icon}</div>
                <div style={{fontSize:'15px',fontWeight:600,color:'#f5f0e8',marginBottom:'10px'}}>{f.title}</div>
                <div style={{fontSize:'13px',color:'rgba(245,240,232,0.45)',lineHeight:'1.65',fontWeight:300}}>{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* GALLERY */}
      <section style={{padding:'0 0 0 0',borderTop:'1px solid rgba(245,240,232,0.06)',position:'relative',overflow:'hidden'}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',height:'420px'}}>
          <div style={{backgroundImage:'url(/images/1i.jpg)',backgroundSize:'cover',backgroundPosition:'center',position:'relative'}}>
            <div style={{position:'absolute',inset:0,background:'linear-gradient(to top,rgba(10,10,8,0.7),transparent)'}} />
            <div style={{position:'absolute',bottom:'24px',left:'24px'}}>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:'10px',color:'#22c997',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:'4px'}}>Members</div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:'22px',color:'#f5f0e8'}}>Real People,<br/>Real Results</div>
            </div>
          </div>
          <div style={{backgroundImage:'url(/images/2i.jpg)',backgroundSize:'cover',backgroundPosition:'center',position:'relative'}}>
            <div style={{position:'absolute',inset:0,background:'linear-gradient(to top,rgba(10,10,8,0.7),transparent)'}} />
            <div style={{position:'absolute',bottom:'24px',left:'24px'}}>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:'10px',color:'#22c997',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:'4px'}}>Training</div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:'22px',color:'#f5f0e8'}}>World Class<br/>Facilities</div>
            </div>
          </div>
          <div style={{backgroundImage:'url(/images/3i.jpg)',backgroundSize:'cover',backgroundPosition:'center',position:'relative'}}>
            <div style={{position:'absolute',inset:0,background:'linear-gradient(to top,rgba(10,10,8,0.7),transparent)'}} />
            <div style={{position:'absolute',bottom:'24px',left:'24px'}}>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:'10px',color:'#22c997',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:'4px'}}>Community</div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:'22px',color:'#f5f0e8'}}>Built for<br/>Rwanda</div>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" style={{padding:'120px 48px',borderTop:'1px solid rgba(245,240,232,0.06)',background:'rgba(245,240,232,0.01)'}}>
        <div style={{maxWidth:'1200px',margin:'0 auto'}}>
          <div style={{marginBottom:'80px'}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:'11px',color:'#22c997',letterSpacing:'0.12em',textTransform:'uppercase',marginBottom:'12px'}}>{T.s1}</div>
            <h2 style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:'clamp(40px,5vw,64px)',letterSpacing:'0.02em',lineHeight:0.95}}>{T.s2a}<br/>{T.s2b}</h2>
          </div>
          <div className="mob-col" style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'48px'}}>
            {[
              {n:'01',title:T.t1,desc:T.d1},
              {n:'02',title:T.t2,desc:T.d2},
              {n:'03',title:T.t3,desc:T.d3},
            ].map(s=>(
              <div key={s.n} style={{position:'relative',paddingTop:'24px'}}>
                <div className="step-num">{s.n}</div>
                <div style={{width:'40px',height:'1px',background:'linear-gradient(135deg,#0F6E56,#1a9b7a)',marginBottom:'28px'}} />
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:'11px',color:'rgba(245,240,232,0.3)',letterSpacing:'0.1em',marginBottom:'12px'}}>STEP {s.n}</div>
                <div style={{fontSize:'20px',fontWeight:600,color:'#f5f0e8',marginBottom:'12px'}}>{s.title}</div>
                <div style={{fontSize:'14px',color:'rgba(245,240,232,0.45)',lineHeight:'1.65',fontWeight:300}}>{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" style={{padding:'120px 48px',borderTop:'1px solid rgba(245,240,232,0.06)'}}>
        <div style={{maxWidth:'900px',margin:'0 auto'}}>
          <div style={{marginBottom:'64px'}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:'11px',color:'#22c997',letterSpacing:'0.12em',textTransform:'uppercase',marginBottom:'12px'}}>Pricing</div>
            <h2 style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:'clamp(40px,5vw,64px)',letterSpacing:'0.02em',lineHeight:0.95}}>{T.ptitle}<br/>{T.ptitle2}</h2>
          </div>
          <div style={{border:'1px solid rgba(245,240,232,0.1)',overflow:'hidden'}}>
            <div style={{background:'linear-gradient(135deg,#0F6E56,#1a9b7a)',padding:'20px 40px',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'12px'}}>
              <div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:'10px',letterSpacing:'0.1em',color:'#fff',textTransform:'uppercase',marginBottom:'4px'}}>Limited time offer</div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:'32px',color:'#fff',lineHeight:1}}>3 MONTHS FREE TRIAL</div>
              </div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:'56px',color:'#fff',lineHeight:1}}>FREE</div>
            </div>
            <div style={{padding:'40px',background:'rgba(245,240,232,0.02)'}}>
              <p style={{fontSize:'15px',color:'rgba(245,240,232,0.5)',marginBottom:'32px',fontWeight:300,lineHeight:1.6}}>
                {T.pdesc}
              </p>
              <div className="mob-2" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px',marginBottom:'40px'}}>
                {['Unlimited member profiles','Smart QR check-in system','Corporate HR billing portal','AI business analytics','MTN MoMo payment collection','PDF & CSV report exports','SMS notifications','Multi-service management'].map(f=>(
                  <div key={f} style={{display:'flex',alignItems:'center',gap:'10px',fontSize:'13px',color:'rgba(245,240,232,0.65)'}}>
                    <span style={{color:'#22c997',fontWeight:700,fontFamily:"'DM Mono',monospace"}}>+</span> {f}
                  </div>
                ))}
              </div>
              <div style={{display:'flex',gap:'12px',alignItems:'center',flexWrap:'wrap'}}>
                <button className="btn-primary" onClick={()=>navigate('/signup')} style={{borderRadius:'100px',fontSize:'14px',padding:'16px 36px'}}>{T.start} →</button>
                <span style={{fontSize:'12px',color:'rgba(245,240,232,0.3)',fontFamily:"'DM Mono',monospace"}}>No credit card required</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{padding:'120px 48px',borderTop:'1px solid rgba(245,240,232,0.06)',position:'relative',overflow:'hidden'}}>
        <div style={{position:'absolute',inset:0,background:'radial-gradient(ellipse 60% 80% at 50% 50%,rgba(34,201,151,0.05) 0%,transparent 70%)',pointerEvents:'none'}} />
        <div style={{maxWidth:'900px',margin:'0 auto',textAlign:'center',position:'relative'}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:'11px',color:'#22c997',letterSpacing:'0.12em',textTransform:'uppercase',marginBottom:'24px'}}>Ready?</div>
          <h2 style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:'clamp(56px,8vw,96px)',lineHeight:'0.9',letterSpacing:'0.02em',marginBottom:'32px'}}>
            {T.cta1}<br/>{T.cta2}<br/><span style={{color:'#22c997'}}>{T.cta3}</span>
          </h2>
          <p style={{fontSize:'16px',color:'rgba(245,240,232,0.45)',marginBottom:'48px',fontWeight:300,lineHeight:1.7,maxWidth:'500px',margin:'0 auto 48px'}}>
            {T.ctad}
          </p>
          <div style={{display:'flex',gap:'12px',justifyContent:'center',flexWrap:'wrap'}}>
            <button className="btn-primary" onClick={()=>navigate('/signup')} style={{borderRadius:'100px',fontSize:'14px',padding:'16px 40px'}}>{T.start} →</button>
            <button className="btn-ghost" onClick={()=>navigate('/hr/login')} style={{borderRadius:'100px',fontSize:'14px',padding:'16px 40px'}}>{T.hr}</button>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer id="contact" style={{borderTop:'1px solid rgba(245,240,232,0.06)',padding:'48px',background:'rgba(245,240,232,0.01)'}}>
        <div style={{maxWidth:'1200px',margin:'0 auto'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:'40px',marginBottom:'48px'}}>
            <div>
              <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'12px'}}>
                <div style={{width:'28px',height:'28px',background:'linear-gradient(135deg,#0F6E56,#1a9b7a)',borderRadius:'3px',display:'flex',alignItems:'center',justifyContent:'center'}}>
                  <svg width="16" height="16" viewBox="0 0 64 64" fill="none"><line x1="18" y1="32" x2="46" y2="32" stroke="#0a0a08" strokeWidth="5" strokeLinecap="round"/><rect x="12" y="24" width="7" height="16" rx="2" fill="#0a0a08"/><rect x="45" y="24" width="7" height="16" rx="2" fill="#0a0a08"/></svg>
                </div>
                <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:'20px',letterSpacing:'0.05em'}}>GymMind</span>
              </div>
              <p style={{fontSize:'13px',color:'rgba(245,240,232,0.35)',lineHeight:1.6,maxWidth:'220px',fontWeight:300}}>{T.tag}</p>
            </div>
            <div style={{display:'flex',gap:'64px',flexWrap:'wrap'}}>
              {[
                {title:'Product',links:[{l:'Features',h:'#features'},{l:'Pricing',h:'#pricing'},{l:'Sign Up',h:'/signup'},{l:'Login',h:'/login'}]},
                {title:'Portals',links:[{l:'Manager Login',h:'/login'},{l:'HR Portal',h:'/hr/login'}]},
                {title:'Contact',links:[{l:'info@gymmind.rw',h:'mailto:info@gymmind.rw'},{l:'support@gymmind.rw',h:'mailto:support@gymmind.rw'}]},
              ].map(col=>(
                <div key={col.title}>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:'10px',letterSpacing:'0.1em',color:'rgba(245,240,232,0.3)',textTransform:'uppercase',marginBottom:'16px'}}>{col.title}</div>
                  {col.links.map(lk=>(
                    <div key={lk.l} style={{marginBottom:'10px'}}>
                      <a href={lk.h} style={{fontSize:'13px',color:'rgba(245,240,232,0.45)',textDecoration:'none'}}
                        onMouseEnter={e=>(e.target as HTMLElement).style.color='#f5f0e8'}
                        onMouseLeave={e=>(e.target as HTMLElement).style.color='rgba(245,240,232,0.45)'}>{lk.l}</a>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',paddingTop:'32px',borderTop:'1px solid rgba(245,240,232,0.06)',flexWrap:'wrap',gap:'12px'}}>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:'11px',color:'rgba(245,240,232,0.2)',letterSpacing:'0.05em'}}>© 2026 GYMMIND · KIGALI, RWANDA 🇷🇼</span>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:'11px',color:'rgba(245,240,232,0.2)',letterSpacing:'0.05em'}}>BUILT FOR RWANDAN GYMS</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
