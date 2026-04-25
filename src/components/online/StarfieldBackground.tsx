'use client';

import React, { useEffect, useRef, useCallback } from 'react';

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
  /** 星星数量 */
  starCount?: number;
  /** 星云数量 */
  nebulaCount?: number;
  /** 匹配阶段，影响背景色调 */
  phase?: 'searching' | 'expanding' | 'starting';
  /** 匹配成功时触发 */
  matchSuccess?: boolean;
}

// 阶段颜色配置 - 移到组件外部避免重复创建
const PHASE_COLORS = {
  searching: { r: 6, g: 182, b: 212 },    // 青色
  expanding: { r: 124, g: 58, b: 237 },   // 紫色
  starting: { r: 239, g: 68, b: 68 },      // 红色
} as const;

// 星云颜色模板 - 提前格式化
const NEBULA_COLOR_TEMPLATES = [
  'rgba(124, 58, 237, OPACITY)',  // 紫色
  'rgba(6, 182, 212, OPACITY)',   // 青色
  'rgba(59, 130, 246, OPACITY)',  // 蓝色
  'rgba(236, 72, 153, OPACITY)',  // 粉色
];

function StarfieldBackgroundComponent({
  starCount = 200,
  nebulaCount = 3,
  phase = 'searching',
  matchSuccess = false,
}: StarfieldBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const starsRef = useRef<Star[]>([]);
  const nebulaeRef = useRef<Nebula[]>([]);
  const animationRef = useRef<number>(undefined);
  const timeRef = useRef<number>(0);
  // 使用 ref 存储 phase 和 matchSuccess 避免 useEffect 重新订阅
  const phaseRef = useRef(phase);
  const matchSuccessRef = useRef(matchSuccess);

  // 更新 refs
  useEffect(() => {
    phaseRef.current = phase;
    matchSuccessRef.current = matchSuccess;
  }, [phase, matchSuccess]);

  // 初始化星星
  const initStars = useCallback((width: number, height: number) => {
    starsRef.current = Array.from({ length: starCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      z: Math.random() * 3 + 0.5, // 深度影响移动速度
      size: Math.random() * 2 + 0.5,
      opacity: Math.random() * 0.8 + 0.2,
      twinkleSpeed: Math.random() * 0.02 + 0.005,
      twinkleOffset: Math.random() * Math.PI * 2,
    }));
  }, [starCount]);

  // 初始化星云
  const initNebulae = useCallback((width: number, height: number) => {
    nebulaeRef.current = Array.from({ length: nebulaCount }, (_, i) => ({
      x: Math.random() * width,
      y: Math.random() * height,
      radius: Math.random() * 200 + 150,
      color: NEBULA_COLOR_TEMPLATES[i % NEBULA_COLOR_TEMPLATES.length],
      opacity: Math.random() * 0.08 + 0.03,
      drift: {
        x: (Math.random() - 0.5) * 0.15,
        y: (Math.random() - 0.5) * 0.1,
      },
    }));
  }, [nebulaCount]);

  // 动画循环 - 使用 useRef 缓存以避免重新创建
  type PhaseColor = typeof PHASE_COLORS[keyof typeof PHASE_COLORS];
  
  const animateRef = useRef<{
    drawStars: (ctx: CanvasRenderingContext2D, width: number, height: number, time: number, color: PhaseColor) => void;
    drawNebulae: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
    drawMatchSuccess: (ctx: CanvasRenderingContext2D, width: number, height: number, time: number) => void;
  } | null>(null);

  // 初始化绘制函数
  useEffect(() => {
    type PhaseColor = typeof PHASE_COLORS[keyof typeof PHASE_COLORS];
    
    // 绘制星星
    const drawStars = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number, color: PhaseColor) => {
      const stars = starsRef.current;
      const len = stars.length;

      for (let i = 0; i < len; i++) {
        const star = stars[i];
        
        // 闪烁效果
        const twinkle = Math.sin(time * star.twinkleSpeed + star.twinkleOffset);
        const currentOpacity = star.opacity * (0.7 + twinkle * 0.3);

        // 移动（视差效果）
        star.x -= star.z * 0.15;
        if (star.x < 0) {
          star.x = width;
          star.y = Math.random() * height;
        }

        // 绘制星星
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${currentOpacity})`;
        ctx.fill();

        // 大星星添加光晕 - 仅当尺寸足够大时
        if (star.size > 1.5) {
          const gradient = ctx.createRadialGradient(
            star.x, star.y, 0,
            star.x, star.y, star.size * 3
          );
          gradient.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, ${currentOpacity * 0.4})`);
          gradient.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);
          ctx.beginPath();
          ctx.arc(star.x, star.y, star.size * 3, 0, Math.PI * 2);
          ctx.fillStyle = gradient;
          ctx.fill();
        }
      }
    };

    // 绘制星云
    const drawNebulae = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      const nebulae = nebulaeRef.current;
      const len = nebulae.length;

      for (let i = 0; i < len; i++) {
        const nebula = nebulae[i];
        
        // 漂移
        nebula.x += nebula.drift.x;
        nebula.y += nebula.drift.y;

        // 边界循环
        if (nebula.x < -nebula.radius) nebula.x = width + nebula.radius;
        if (nebula.x > width + nebula.radius) nebula.x = -nebula.radius;
        if (nebula.y < -nebula.radius) nebula.y = height + nebula.radius;
        if (nebula.y > height + nebula.radius) nebula.y = -nebula.radius;

        // 绘制星云
        const gradient = ctx.createRadialGradient(
          nebula.x, nebula.y, 0,
          nebula.x, nebula.y, nebula.radius
        );
        gradient.addColorStop(0, nebula.color.replace('OPACITY', String(nebula.opacity)));
        gradient.addColorStop(0.5, nebula.color.replace('OPACITY', String(nebula.opacity * 0.5)));
        gradient.addColorStop(1, nebula.color.replace('OPACITY', '0'));

        ctx.beginPath();
        ctx.arc(nebula.x, nebula.y, nebula.radius, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
      }
    };

    // 匹配成功特效
    const drawMatchSuccessEffect = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number) => {
      const pulseRadius = (time * 100) % 400;
      const maxRadius = Math.sqrt(width * width + height * height) / 2;
      const opacity = Math.max(0, 1 - pulseRadius / maxRadius);

      // 扩散波纹
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, pulseRadius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(6, 182, 212, ${opacity * 0.6})`;
      ctx.lineWidth = 3;
      ctx.stroke();

      // 第二圈波纹
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

    // 动画循环 - 不依赖外部状态
    const animate = (timestamp: number) => {
      timeRef.current = timestamp / 1000;

      // 清除画布
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 获取当前阶段颜色
      const color = PHASE_COLORS[phaseRef.current];

      // 绘制星云（底层）
      if (animateRef.current) {
        animateRef.current.drawNebulae(ctx, canvas.width, canvas.height);
        
        // 绘制星星
        animateRef.current.drawStars(ctx, canvas.width, canvas.height, timeRef.current, color);

        // 匹配成功特效
        if (matchSuccessRef.current) {
          animateRef.current.drawMatchSuccess(ctx, canvas.width, canvas.height, timeRef.current);
        }
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('resize', resize);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [initStars, initNebulae]); // 移除 phase 和 matchSuccess 依赖

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 0 }}
    />
  );
};

export const StarfieldBackground = React.memo(StarfieldBackgroundComponent);
