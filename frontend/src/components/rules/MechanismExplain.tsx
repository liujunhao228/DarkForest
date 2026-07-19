import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Radio, Crosshair, Factory, Trophy } from 'lucide-react';
import type { GameMechanisms } from '@/api/rules';

// ============================================================================
// 收益矩阵
// ============================================================================

interface PayoffRow {
  broadcaster: '合作' | '伪装';
  responder: '合作' | '伪装';
  broadcasterGain: number;
  responderGain: number;
  summary: string;
}

const PAYOFF_ROWS: PayoffRow[] = [
  { broadcaster: '合作', responder: '合作', broadcasterGain: 3, responderGain: 3, summary: '双赢' },
  { broadcaster: '合作', responder: '伪装', broadcasterGain: 0, responderGain: 5, summary: '伪装者获利' },
  { broadcaster: '伪装', responder: '合作', broadcasterGain: 5, responderGain: 0, summary: '伪装者获利' },
  { broadcaster: '伪装', responder: '伪装', broadcasterGain: 0, responderGain: 0, summary: '双输' },
];

function BroadcastPayoffMatrix() {
  return (
    <div className="space-y-2">
      <div className="text-xs text-slate-400">收益矩阵（广播者 / 回应者）：</div>
      <div className="overflow-hidden rounded-md border border-slate-800">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-900/80 border-b border-slate-800">
              <th className="px-2 py-1.5 text-left text-slate-400 font-medium">广播者 ↓ / 回应者 →</th>
              <th className="px-2 py-1.5 text-center text-cyan-300 font-medium">合作</th>
              <th className="px-2 py-1.5 text-center text-purple-300 font-medium">伪装</th>
            </tr>
          </thead>
          <tbody>
            {PAYOFF_ROWS.map((row, idx) => {
              const isRowCoop = row.broadcaster === '合作';
              const isColCoop = row.responder === '合作';
              return (
                <tr key={idx} className="border-b border-slate-800/60 last:border-b-0">
                  <td className={cn('px-2 py-1.5 font-medium', isRowCoop ? 'text-cyan-300' : 'text-purple-300')}>
                    {row.broadcaster}
                  </td>
                  <td className="px-2 py-1.5 text-center text-slate-300">
                    {isRowCoop && isColCoop ? (
                      <span className="text-green-400">{row.broadcasterGain} / {row.responderGain}</span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center text-slate-300">
                    {!isRowCoop && !isColCoop ? (
                      <span className="text-red-400">{row.broadcasterGain} / {row.responderGain}</span>
                    ) : !isRowCoop && isColCoop ? (
                      <span className="text-amber-400">{row.broadcasterGain} / {row.responderGain}</span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-1 gap-1 text-[10px] text-slate-500">
        <div><span className="text-green-400">绿色</span>：双方合作各得 3 能量</div>
        <div><span className="text-amber-400">黄色</span>：伪装方得 5，合作方得 0</div>
        <div><span className="text-red-400">红色</span>：双方伪装均不得能量</div>
      </div>
    </div>
  );
}

// ============================================================================
// 机制卡片
// ============================================================================

interface MechanismCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  children?: React.ReactNode;
  accent: string;
}

function MechanismCard({ icon, title, description, children, accent }: MechanismCardProps) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-2">
      <div className="flex items-center gap-2">
        <span className={cn('inline-flex items-center justify-center w-7 h-7 rounded-md', accent)}>
          {icon}
        </span>
        <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      </div>
      <p className="text-xs leading-relaxed text-slate-400">{description}</p>
      {children}
    </div>
  );
}

// ============================================================================
// MechanismExplain
// ============================================================================

export interface MechanismExplainProps {
  mechanisms: GameMechanisms;
}

export function MechanismExplain({ mechanisms }: MechanismExplainProps) {
  return (
    <div className="space-y-4">
      {mechanisms.broadcast && (
        <MechanismCard
          icon={<Radio className="w-4 h-4 text-cyan-300" />}
          title="广播博弈"
          description={mechanisms.broadcast.description}
          accent="bg-cyan-500/10"
        >
          <BroadcastPayoffMatrix />
          {mechanisms.broadcast.phases && mechanisms.broadcast.phases.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              <span className="text-[10px] text-slate-500">阶段：</span>
              {mechanisms.broadcast.phases.map((p) => (
                <Badge key={p} variant="outline" className="text-[10px] border-slate-700 text-slate-400">
                  {p}
                </Badge>
              ))}
            </div>
          )}
        </MechanismCard>
      )}

      {mechanisms.strike && (
        <MechanismCard
          icon={<Crosshair className="w-4 h-4 text-red-300" />}
          title="打击机制"
          description={mechanisms.strike.description}
          accent="bg-red-500/10"
        >
          <div className="space-y-2 text-xs">
            <div>
              <div className="text-slate-500 mb-1">出现位置：</div>
              <div className="flex flex-wrap gap-1">
                {mechanisms.strike.originModes.map((m) => (
                  <Badge key={m} variant="outline" className="text-[10px] border-red-500/40 text-red-300">
                    {m === 'direct' ? '即刻判定' : m === 'ownerPlanet' ? '逐跳飞行' : m === 'stealthOwnerPlanet' ? '隐式飞行' : m}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <div className="text-slate-500 mb-1">落空处理：</div>
              <div className="flex flex-wrap gap-1">
                {mechanisms.strike.missBehaviors.map((m) => (
                  <Badge key={m} variant="outline" className="text-[10px] border-amber-500/40 text-amber-300">
                    {m === 'discard' ? '废弃' : m === 'freeControl' ? '自由控制' : m === 'requireTarget' ? '必须重定向' : m}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </MechanismCard>
      )}

      {mechanisms.settlement && (
        <MechanismCard
          icon={<Factory className="w-4 h-4 text-emerald-300" />}
          title="设施结算"
          description={mechanisms.settlement.description}
          accent="bg-emerald-500/10"
        >
          {mechanisms.settlement.starDependentFacilities.length > 0 && (
            <div className="text-xs">
              <div className="text-slate-500 mb-1">依赖恒星的设施：</div>
              <div className="flex flex-wrap gap-1">
                {mechanisms.settlement.starDependentFacilities.map((f) => (
                  <Badge key={f} variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-300">
                    {f === 'facility_solar_array' ? '太阳能阵列' : f === 'facility_dyson_sphere' ? '戴森球' : f}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </MechanismCard>
      )}

      {mechanisms.winCondition && (
        <MechanismCard
          icon={<Trophy className="w-4 h-4 text-amber-300" />}
          title="胜负条件"
          description={mechanisms.winCondition.description}
          accent="bg-amber-500/10"
        />
      )}
    </div>
  );
}
