import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import advisorAvatar from '../../../assets/advisor-avatar.png';
import s from './AdvisorBubble.module.css';

interface AdvisorBubbleProps {
  message: string;
  typing?: boolean;
  onDone?: () => void;
}

const AdvisorBubble: React.FC<AdvisorBubbleProps> = ({ message, typing = true, onDone }) => {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(!typing);

  useEffect(() => {
    if (!typing) { setDisplayed(message); setDone(true); onDone?.(); return; }
    setDisplayed('');
    setDone(false);
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setDisplayed(message.slice(0, i));
      if (i >= message.length) { clearInterval(interval); setDone(true); onDone?.(); }
    }, 22);
    return () => clearInterval(interval);
  }, [message, typing]);

  return (
    <motion.div
      className={s.wrap}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <div className={s.avatar}>
        <img src={advisorAvatar} alt="Conseillère VB" className={s.avatarImg} />
        <div className={s.onlineDot} />
      </div>
      <div className={s.bubble}>
        <span className={s.name}>Marie-Ève</span>
        <p className={s.text}>
          {displayed}
          {!done && <span className={s.cursor}>|</span>}
        </p>
      </div>
    </motion.div>
  );
};

export default AdvisorBubble;
