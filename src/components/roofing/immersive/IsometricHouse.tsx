import React from 'react';
import h from './IsometricHouse.module.css';

const HALF_BASE = 100;

const PITCH_MAP: Record<string, number> = {
  '4-7':  85,
  '7-9':  105,
  '9-12': 125,
  '12+':  150,
};

interface Props {
  pitch?: string;
  debug?: boolean;
}

const A = ({ d, children }: { d: number; children: React.ReactNode }) => (
  <span className={h.assemble} style={{ '--d': d } as React.CSSProperties}>
    {children}
  </span>
);

/**
 * Edge label: placed at a specific position inside its parent face.
 * top/left are % of the parent face's box.
 */
const E = ({ n, top, left }: { n: number; top: string; left: string }) => (
  <span className={h.edgeLabel} style={{ top, left }}>{n}</span>
);

const IsometricHouse: React.FC<Props> = ({ pitch = '7-9', debug = false }) => {
  const roofRise = PITCH_MAP[pitch] || PITCH_MAP['7-9'];
  const slopeSkew = Math.round(Math.atan(HALF_BASE / roofRise) * (180 / Math.PI) * 10) / 10;

  return (
    <div
      className={h.wrap}
      style={{
        '--roofRise': `${roofRise}px`,
        '--slopeSkew': `${slopeSkew}deg`,
      } as React.CSSProperties}
    >
      <div className={`${h.glow} ${h.assemble}`} style={{ '--d': 8 } as React.CSSProperties} />
      <div className={h.house}>

        {/* ROOF PLANE — 4 edges */}
        <A d={7}><span className={`${h.face} ${h.roof}`}>
          {debug && <>
            <E n={1} top="0%" left="50%" />    {/* top edge */}
            <E n={2} top="100%" left="50%" />   {/* bottom edge */}
            <E n={3} top="50%" left="0%" />     {/* left edge */}
            <E n={4} top="50%" left="100%" />   {/* right edge */}
          </>}
        </span></A>

        {/* GABLE (cutout) — slope lines are ::before/::after */}
        <A d={6}><span className={`${h.face} ${h.cutout}`}>
          {debug && <>
            <E n={5} top="50%" left="-25%" />   {/* left slope line (::before) */}
            <E n={6} top="50%" left="125%" />    {/* right slope line (::after) */}
            <E n={7} top="100%" left="50%" />    {/* gable base */}
          </>}
        </span></A>

        {/* RIGHT WALL — 4 edges */}
        <A d={0}><span className={`${h.face} ${h.right}`}>
          {debug && <>
            <E n={8} top="0%" left="50%" />     {/* top */}
            <E n={9} top="100%" left="50%" />    {/* bottom */}
            <E n={10} top="50%" left="0%" />     {/* left */}
            <E n={11} top="50%" left="100%" />   {/* right */}
          </>}
        </span></A>

        {/* LEFT WALL — 4 edges */}
        <A d={1}><span className={`${h.face} ${h.left}`}>
          {debug && <>
            <E n={12} top="0%" left="50%" />     {/* top */}
            <E n={13} top="100%" left="50%" />    {/* bottom */}
            <E n={14} top="50%" left="0%" />      {/* left */}
            <E n={15} top="50%" left="100%" />    {/* right */}
          </>}
        </span></A>

        {/* DOOR */}
        <A d={2}><span className={`${h.face} ${h.door}`}>
          <span className={h.knob} />
          {debug && <E n={16} top="50%" left="50%" />}
        </span></A>

        {/* WINDOW LEFT */}
        <A d={3}><span className={`${h.face} ${h.windowLeft}`}>
          <span className={h.plus} />
          {debug && <E n={17} top="50%" left="50%" />}
        </span></A>

        {/* WINDOW RIGHT */}
        <A d={4}><span className={`${h.face} ${h.windowRight}`}>
          <span className={h.plus} />
          {debug && <E n={18} top="50%" left="50%" />}
        </span></A>

        {/* ROUND WINDOW */}
        <A d={5}><span className={`${h.face} ${h.windowRightTop}`}>
          {debug && <E n={19} top="50%" left="50%" />}
        </span></A>

      </div>
    </div>
  );
};

export default IsometricHouse;
