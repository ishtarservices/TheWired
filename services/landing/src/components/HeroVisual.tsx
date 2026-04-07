import { motion } from 'motion/react';

export default function HeroVisual() {
  return (
    <div className="relative w-full h-full flex items-end justify-center">
      {/* Neon glow behind character */}
      <div
        className="absolute bottom-[5%] left-1/2 -translate-x-1/2 w-[350px] h-[350px] rounded-full blur-[120px]"
        style={{ background: 'radial-gradient(circle, hsl(185 100% 55% / 0.12), hsl(265 100% 70% / 0.06), transparent)' }}
      />

      {/* Ground reflection glow */}
      <div
        className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-[80%] h-[60px] blur-[40px] rounded-full"
        style={{ background: 'hsl(185 100% 55% / 0.08)' }}
      />

      {/* Main character — cinematic entrance */}
      <motion.div
        className="relative z-10 w-full max-w-[440px]"
        initial={{ opacity: 0, y: 60, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 1, delay: 0.15, ease: [0.34, 1.56, 0.64, 1] }}
      >
        <img
          src="/characters/hero-girl.png"
          alt=""
          className="w-full h-auto"
          style={{
            filter: 'drop-shadow(0 0 40px hsl(185 100% 55% / 0.2)) drop-shadow(0 0 80px hsl(265 100% 70% / 0.1))',
          }}
          loading="eager"
        />
      </motion.div>

      {/* HUD elements — floating data around character */}
      {/* Bracket left */}
      <motion.div
        className="absolute z-20 text-[10px] font-mono tracking-wider"
        style={{ top: '25%', left: '3%', color: 'hsl(185 100% 55% / 0.35)' }}
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6, delay: 1 }}
      >
        <div className="flex flex-col gap-1">
          <span>[SYS.INIT]</span>
          <span style={{ color: 'hsl(185 100% 55% / 0.25)' }}>&#9472;&#9472;&#9472;</span>
          <span>NOSTR://</span>
          <span>RELAY.OK</span>
        </div>
      </motion.div>

      {/* Status right */}
      <motion.div
        className="absolute z-20 text-[10px] font-mono tracking-wider text-right"
        style={{ top: '30%', right: '3%', color: 'hsl(310 100% 65% / 0.3)' }}
        initial={{ opacity: 0, x: 10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6, delay: 1.2 }}
      >
        <div className="flex flex-col gap-1 items-end">
          <span>v0.1.0</span>
          <span style={{ color: 'hsl(310 100% 65% / 0.2)' }}>&#9472;&#9472;&#9472;</span>
          <span>DECRYPT</span>
          <span>E2E.ON</span>
        </div>
      </motion.div>

      {/* Floating cyber orbs */}
      <motion.div
        className="absolute w-2 h-2 rounded-full z-20"
        style={{ top: '18%', right: '22%', background: 'hsl(185 100% 55%)', boxShadow: '0 0 8px hsl(185 100% 55% / 0.6)' }}
        animate={{ y: [0, -18, 0], opacity: [0.4, 1, 0.4], scale: [1, 1.3, 1] }}
        transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute w-1.5 h-1.5 rounded-full z-20"
        style={{ top: '40%', left: '12%', background: 'hsl(310 100% 65%)', boxShadow: '0 0 8px hsl(310 100% 65% / 0.5)' }}
        animate={{ y: [0, -12, 0], opacity: [0.3, 0.8, 0.3] }}
        transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut', delay: 1.5 }}
      />
      <motion.div
        className="absolute w-2.5 h-2.5 rounded-full z-20"
        style={{ bottom: '30%', right: '8%', background: 'hsl(265 100% 70%)', boxShadow: '0 0 10px hsl(265 100% 70% / 0.5)' }}
        animate={{ y: [0, -15, 0], opacity: [0.3, 0.9, 0.3], scale: [1, 1.2, 1] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 0.8 }}
      />

      {/* Horizontal scan line on character area */}
      <motion.div
        className="absolute z-15 w-[60%] h-[1px] left-[20%]"
        style={{ top: '35%', background: 'linear-gradient(90deg, transparent, hsl(185 100% 55% / 0.15), transparent)' }}
        animate={{ opacity: [0, 0.6, 0], top: ['30%', '70%', '30%'] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
      />
    </div>
  );
}
