import { useNavigate } from 'react-router-dom';
import GymMindLogo from '../components/GymMindLogo';
import s from './Landing.module.css';

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className={s.page}>
      <div className={s.card}>

        {/* Logo */}
        <GymMindLogo size={120} variant="color" />
        <div className={s.brandName}>GymMind</div>
        <div className={s.brandAccent} />
        <div className={s.brandSub}>Gym management for Rwanda &amp; East Africa</div>

        {/* Buttons */}
        <div className={s.btnStack}>
          <button type="button" className={s.btnPrimary} onClick={() => navigate('/signup')}>
            <span className={s.btnLine1}>Create your gym account →</span>
            <span className={s.btnLine2}>Free — takes 2 minutes</span>
          </button>

          <button type="button" className={s.btnSecondary} onClick={() => navigate('/login')}>
            <span className={s.btnLine1Secondary}>Login to my gym</span>
            <span className={s.btnLine2Secondary}>Already have an account</span>
          </button>
        </div>

        {/* Institution portal link */}
        <button type="button" className={s.institutionLink} onClick={() => navigate('/institution/login')}>
          Are you from a company? Access your portal →
        </button>

        {/* Footer */}
        <div className={s.footer}>GymMind · Made for Rwanda 🇷🇼 · <a href='mailto:info@gymmind.rw' style={{color:'inherit'}}>info@gymmind.rw</a> · <a href='mailto:support@gymmind.rw' style={{color:'inherit'}}>support@gymmind.rw</a></div>

      </div>
    </div>
  );
}
