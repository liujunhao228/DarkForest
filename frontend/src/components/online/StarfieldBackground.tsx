import { useEffect, useRef, useCallback } from 'react';

interface Star {
  x: number;
  y: number;
  z: number;
  size: number;
  opacity: number;
  twinkleSpeed: number;
  twinkleOffset: number;
}

interface Nebula {
  x: number;
  y: number;
  radius: number;
  color: string;
  opacity: number;
  drift: { x: number; y: number };
}

interface StarfieldBackgroundProps {
  starCount?: number;
  nebulaCount?: number;
  phase?: 'searching' | 'expanding' | 'starting';
  matchSuccess?: boolean;
}

const PHASE_COLORS = {
  searching: { r: 6, g: 182, b: 212 },
  expanding: { r: 124, g: 58, b: 237 },
  starting: { r: 239, g: 68, b: 68 },
} as const;

const NEBULA_COLOR_TEMPLATES = [
  'rgba(124, 58, 237, OPACITY)',
  'rgba(6, 182, 212, OPACITY)',
  'rgba(59, 130, 246, OPACITY)',
  'rgba(236, 72, 153, OPACITY)',
];

function StarfieldBackgroundComponent({ starCount = 200, nebulaCount = 3, phase = 'searching', matchSuccess = false }: StarfieldBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const starsRef = useRef<Star[]>([]);
  const nebulaeRef = useRef<Nebula[]>([]);
  const animationRef = useRef<number>(undefined);
  const timeRef = useRef<number>(0);
  const phaseRef = useRef(phase);
  const matchSuccessRef = useRef(matchSuccess);

  useEffect(() => { phaseRef.current = phase; matchSuccessRef.current = matchSuccess; }, [phase, matchSuccess]);

  const initStars = useCallback((width: number, height: number) => {
    starsRef.current = Array.from({ length: starCount }, () => ({
      x: Math.random() * width, y: Math.random() * height, z: Math.random() * 3 + 0.5,
      size: Math.random() * 2 + 0.5, opacity: Math.random() * 0.8 + 0.2,
      twinkleSpeed: Math.random() * 0.02 + 0.005, twinkleOffset: Math.random() * Math.PI * 2,
    }));
  }, [starCount]);

  const initNebulae = useCallback((width: number, height: number) => {
    nebulaeRef.current = Array.from({ length: nebulaCount }, (_, i) => ({
      x: Math.random() * width, y: Math.random() * height, radius: Math.random() * 200 + 150,
      color: NEBULA_COLOR_TEMPLATES[i % NEBULA_COLOR_TEMPLATES.length],
      opacity: Math.random() * 0.08 + 0.03,
      drift: { x: (Math.random() - 0.5) * 0.15, y: (Math.random() - 0.5) * 0.1 },
    }));
  }, [nebulaCount]);

  const animateRef = useRef<{
    drawStars: (ctx: CanvasRenderingContext2D, width: number, height: number, time: number, color: { r: number; g: number; b: number }) => void;
    drawNebulae: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
    drawMatchSuccess: (ctx: CanvasRenderingContext2D, width: number, height: number, time: number) => void;
  } | null>(null);

  useEffect(() => {
    const drawStars = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number, color: { r: number; g: number; b: number }) => {
      const stars = starsRef.current;
      for (let i = 0; i < stars.length; i++) {
        const star = stars[i];
        const twinkle = Math.sin(time * star.twinkleSpeed + star.twinkleOffset);
        const currentOpacity = star.opacity * (0.7 + twinkle * 0.3);
        star.x -= star.z * 0.15;
        if (star.x < 0) { star.x = width; star.y = Math.random() * height; }
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${currentOpacity})`;
        ctx.fill();
        if (star.size > 1.5) {
          const gradient = ctx.createRadialGradient(star.x, star.y, 0, star.x, star.y, star.size * 3);
          gradient.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, ${currentOpacity * 0.4})`);
          gradient.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);
          ctx.beginPath();
          ctx.arc(star.x, star.y, star.size * 3, 0, Math.PI * 2);
          ctx.fillStyle = gradient;
          ctx.fill();
        }
      }
    };

    const drawNebulae = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      const nebulae = nebulaeRef.current;
      for (let i = 0; i < nebulae.length; i++) {
        const nebula = nebulae[i];
        nebula.x += nebula.drift.x;
        nebula.y += nebula.drift.y;
        if (nebula.x < -nebula.radius) nebula.x = width + nebula.radius;
        if (nebula.x > width + nebula.radius) nebula.x = -nebula.radius;
        if (nebula.y < -nebula.radius) nebula.y = height + nebula.radius;
        if (nebula.y > height + nebula.radius) nebula.y = -nebula.radius;
        const gradient = ctx.createRadialGradient(nebula.x, nebula.y, 0, nebula.x, nebula.y, nebula.radius);
        gradient.addColorStop(0, nebula.color.replace('OPACITY', String(nebula.opacity)));
        gradient.addColorStop(0.5, nebula.color.replace('OPACITY', String(nebula.opacity * 0.5)));
        gradient.addColorStop(1, nebula.color.replace('OPACITY', '0'));
        ctx.beginPath();
        ctx.arc(nebula.x, nebula.y, nebula.radius, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
      }
    };

    const drawMatchSuccessEffect = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number) => {
      const pulseRadius = (time * 100) % 400;
      const maxRadius = Math.sqrt(width * width + height * height) / 2;
      const opacity = Math.max(0, 1 - pulseRadius / maxRadius);
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, pulseRadius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(6, 182, 212, ${opacity * 0.6})`;
      ctx.lineWidth = 3;
      ctx.stroke();
      const pulseRadius2 = ((time * 100 + 200) % 400);
      const opacity2 = Math.max(0, 1 - pulseRadius2 / maxRadius);
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, pulseRadius2, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(124, 58, 237, ${opacity2 * 0.4})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    };

    animateRef.current = { drawStars, drawNebulae, drawMatchSuccess: drawMatchSuccessEffect };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      initStars(canvas.width, canvas.height);
      initNebulae(canvas.width, canvas.height);
    };

    resize();
    window.addEventListener('resize', resize);

    const animate = (timestamp: number) => {
      timeRef.current = timestamp / 1000;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const color = PHASE_COLORS[phaseRef.current];
      if (animateRef.current) {
        animateRef.current.drawNebulae(ctx, canvas.width, canvas.height);
        animateRef.current.drawStars(ctx, canvas.width, canvas.height, timeRef.current, color);
        if (matchSuccessRef.current) {
          animateRef.current.drawMatchSuccess(ctx, canvas.width, canvas.height, timeRef.current);
        }
      }
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('resize', resize);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [initStars, initNebulae]);

  return (
    <canvas ref={canvasRef} className="fixed inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }} />
  );
}

export const StarfieldBackground = StarfieldBackgroundComponent;
