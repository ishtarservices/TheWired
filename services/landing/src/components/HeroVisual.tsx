import { motion } from 'motion/react';

export default function HeroVisual() {
  return (
    <div className="relative w-full h-full flex items-end justify-center">
      {/* Subtle glow behind character */}
      <div
        className="absolute bottom-[5%] left-1/2 -translate-x-1/2 w-[500px] h-[400px] rounded-full blur-[140px]"
        style={{ background: 'radial-gradient(circle, #60706040, #78587030, transparent)' }}
      />

      {/* Ground reflection */}
      <div
        className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-[90%] h-[80px] blur-[50px] rounded-full"
        style={{ background: '#60706025' }}
      />

      {/* HUD status bar — grounding element */}
      <motion.div
        className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[95%] z-20 px-4 py-2 flex items-center justify-between font-mono text-[9px] tracking-wider uppercase"
        style={{
          background: '#0C0910e6',
          backdropFilter: 'blur(12px)',
          borderTop: '0.5px solid #384038',
          borderRadius: '6px 6px 0 0',
        }}
        initial={{ opacity: 1, y: 0 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-3" style={{ color: '#384038' }}>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#607060' }} />
            relay.thewired.app
          </span>
          <span style={{ color: '#221A2C' }}>|</span>
          <span>3 relays connected</span>
        </div>
        <div className="flex items-center gap-3" style={{ color: '#2a2030' }}>
          <span>ping 12ms</span>
          <span style={{ color: '#221A2C' }}>|</span>
          <span>nip-29 // nip-42</span>
        </div>
      </motion.div>

      {/* Main character */}
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
            filter: 'drop-shadow(0 0 40px #60706040) drop-shadow(0 0 80px #78587030) drop-shadow(0 0 120px #60706020)',
          }}
          loading="eager"
        />
      </motion.div>

      {/* HUD elements — floating data */}
      <motion.div
        className="absolute z-20 text-[10px] font-mono tracking-wider"
        style={{ top: '25%', left: '3%', color: '#384038' }}
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6, delay: 1 }}
      >
        <div className="flex flex-col gap-1">
          <span>[SYS.INIT]</span>
          <span style={{ color: '#221A2C' }}>&#9472;&#9472;&#9472;</span>
          <span>NOSTR://</span>
          <span>RELAY.OK</span>
        </div>
      </motion.div>

      <motion.div
        className="absolute z-20 text-[10px] font-mono tracking-wider text-right"
        style={{ top: '30%', right: '3%', color: '#2a2030' }}
        initial={{ opacity: 0, x: 10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6, delay: 1.2 }}
      >
        <div className="flex flex-col gap-1 items-end">
          <span>STABLE</span>
          <span style={{ color: '#221A2C' }}>&#9472;&#9472;&#9472;</span>
          <span>DECRYPT</span>
          <span>E2E.ON</span>
        </div>
      </motion.div>

      {/* Floating orbs — muted */}
      <motion.div
        className="absolute w-2 h-2 rounded-full z-20"
        style={{ top: '18%', right: '22%', background: '#607060', boxShadow: 'none' }}
        animate={{ y: [0, -18, 0], opacity: [0.3, 0.7, 0.3], scale: [1, 1.3, 1] }}
        transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute w-1.5 h-1.5 rounded-full z-20"
        style={{ top: '40%', left: '12%', background: '#785870', boxShadow: 'none' }}
        animate={{ y: [0, -12, 0], opacity: [0.2, 0.6, 0.2] }}
        transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut', delay: 1.5 }}
      />
      <motion.div
        className="absolute w-2.5 h-2.5 rounded-full z-20"
        style={{ bottom: '30%', right: '8%', background: '#607060', boxShadow: 'none' }}
        animate={{ y: [0, -15, 0], opacity: [0.2, 0.6, 0.2], scale: [1, 1.2, 1] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 0.8 }}
      />

      {/* Scan line */}
      <motion.div
        className="absolute z-15 w-[60%] h-[1px] left-[20%]"
        style={{ top: '35%', background: 'linear-gradient(90deg, transparent, #38403820, transparent)' }}
        animate={{ opacity: [0, 0.6, 0], top: ['30%', '70%', '30%'] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
      />
    </div>
  );
}
