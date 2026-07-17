import starBroadcastSvg from '@/assets/images/broadcast/star-broadcast.svg';
import cosmicBroadcastSvg from '@/assets/images/broadcast/cosmic-broadcast.svg';
import ultraBroadcastSvg from '@/assets/images/broadcast/ultra-broadcast.svg';
import thermalSvg from '@/assets/images/strike/thermal.svg';
import lightParticleSvg from '@/assets/images/strike/light-particle.svg';
import annihilationSvg from '@/assets/images/strike/annihilation.svg';
import dimensionalSvg from '@/assets/images/strike/dimensional.svg';
import techLockSvg from '@/assets/images/strike/tech-lock.svg';
import shieldRingSvg from '@/assets/images/defense/shield-ring.svg';
import quantumGhostSvg from '@/assets/images/defense/quantum-ghost.svg';
import solarArraySvg from '@/assets/images/facility/solar-array.svg';
import fusionReactorSvg from '@/assets/images/facility/fusion-reactor.svg';
import antimatterEngineSvg from '@/assets/images/facility/antimatter-engine.svg';
import dysonSphereSvg from '@/assets/images/facility/dyson-sphere.svg';
import monitoringStationSvg from '@/assets/images/facility/monitoring-station.svg';
import lightspeedShipSvg from '@/assets/images/facility/lightspeed-ship.svg';
import type { CardDef, Card } from './types';

export const CARD_DEFINITIONS: CardDef[] = [
  {
    id: 'broadcast_star_cooperation',
    name: '恒星广播',
    type: 'broadcast',
    energy: 0,
    quantity: 9,
    description: '向距离 1 以内的星系发送广播信号，若对方回应且双方均选择合作，各获得 3 能量',
    image: starBroadcastSvg,
    extended: { subtype: 'cooperation', range: 1 },
  },
  {
    id: 'broadcast_star_disguise',
    name: '恒星广播',
    type: 'broadcast',
    energy: 0,
    quantity: 5,
    description: '向距离 1 以内的星系发送广播信号，伪装方可获得 5 能量（若对方合作）',
    image: starBroadcastSvg,
    extended: { subtype: 'disguise', range: 1 },
  },
  {
    id: 'broadcast_cosmic_cooperation',
    name: '宇宙广播',
    type: 'broadcast',
    energy: 1,
    quantity: 6,
    description: '向距离 2 以内的星系发送广播信号，若对方回应且双方均选择合作，各获得 3 能量',
    image: cosmicBroadcastSvg,
    extended: { subtype: 'cooperation', range: 2 },
  },
  {
    id: 'broadcast_cosmic_disguise',
    name: '宇宙广播',
    type: 'broadcast',
    energy: 1,
    quantity: 4,
    description: '向距离 2 以内的星系发送广播信号，伪装方可获得 5 能量（若对方合作）',
    image: cosmicBroadcastSvg,
    extended: { subtype: 'disguise', range: 2 },
  },
  {
    id: 'broadcast_ultra_cooperation',
    name: '超距广播',
    type: 'broadcast',
    energy: 2,
    quantity: 2,
    description: '无视距离发送广播信号，若对方回应且双方均选择合作，各获得 3 能量',
    image: ultraBroadcastSvg,
    extended: { subtype: 'cooperation', range: 1000 },
  },
  {
    id: 'broadcast_ultra_disguise',
    name: '超距广播',
    type: 'broadcast',
    energy: 2,
    quantity: 2,
    description: '无视距离发送广播信号，伪装方可获得 5 能量（若对方合作）',
    image: ultraBroadcastSvg,
    extended: { subtype: 'disguise', range: 1000 },
  },
  {
    id: 'strike_thermal',
    name: '热核打击',
    type: 'strike',
    energy: 4,
    quantity: 4,
    description: '打击无特殊效果，可被掩体星环防御',
    image: thermalSvg,
    extended: { level: 1, speed: 1 },
  },
  {
    id: 'strike_light_particle',
    name: '光粒打击',
    type: 'strike',
    energy: 6,
    quantity: 4,
    description: '无论是否被防御，均毁灭目标星系恒星',
    image: lightParticleSvg,
    extended: { level: 2, speed: 1 },
  },
  {
    id: 'strike_annihilation',
    name: '湮灭打击',
    type: 'strike',
    energy: 8,
    quantity: 3,
    description: '无论是否被防御，均毁灭目标星系恒星及所有建设牌',
    image: annihilationSvg,
    extended: { level: 3, speed: 1 },
  },
  {
    id: 'strike_dimensional',
    name: '降维打击',
    type: 'strike',
    energy: 10,
    quantity: 3,
    description: '彻底清除目标星系',
    image: dimensionalSvg,
    extended: { level: 4, speed: 1 },
  },
  {
    id: 'strike_tech_lock',
    name: '科技锁死',
    type: 'strike',
    energy: 4,
    quantity: 3,
    description: '无视防御，打击生效时，目标玩家立即弃掉全部手牌',
    image: techLockSvg,
    extended: { level: 4, speed: 1, effect: 'discard_hand' },
  },
  {
    id: 'defense_shield_ring',
    name: '掩体星环',
    type: 'defense',
    energy: 6,
    quantity: 5,
    description: '可在等级 2 及以下的打击中幸存，可防御热核打击、但不免除光粒打击的效果',
    image: shieldRingSvg,
    extended: { protection_level: 2, duration: 'permanent' },
  },
  {
    id: 'defense_quantum_ghost',
    name: '量子幽灵',
    type: 'defense',
    energy: 8,
    quantity: 3,
    description: '进入量子幽灵态，可在等级 3 及以下的打击中幸存',
    image: quantumGhostSvg,
    extended: { protection_level: 3, duration: 'permanent' },
  },
  {
    id: 'facility_solar_array',
    name: '太阳能阵列',
    type: 'facility',
    energy: 2,
    quantity: 5,
    description: '每回合开始时获得 1 点能量产出，依赖恒星',
    image: solarArraySvg,
    extended: { energy_per_turn: 1, duration: 'permanent' },
  },
  {
    id: 'facility_fusion_reactor',
    name: '聚变反应堆',
    type: 'facility',
    energy: 3,
    quantity: 4,
    description: '每回合获得 1 点能量产出，不依赖恒星',
    image: fusionReactorSvg,
    extended: { energy_per_turn: 1, duration: 'permanent' },
  },
  {
    id: 'facility_antimatter_engine',
    name: '反物质引擎',
    type: 'facility',
    energy: 6,
    quantity: 3,
    description: '每回合获得 2 点能量产出，不依赖恒星',
    image: antimatterEngineSvg,
    extended: { energy_per_turn: 2, duration: 'permanent' },
  },
  {
    id: 'facility_dyson_sphere',
    name: '戴森球',
    type: 'facility',
    energy: 6,
    quantity: 3,
    description: '每回合获得 3 点能量产出，依赖恒星，每个星系只能建造1个',
    image: dysonSphereSvg,
    extended: { energy_per_turn: 3, duration: 'permanent' },
  },
  {
    id: 'facility_monitoring_station',
    name: '监听基地',
    type: 'facility',
    energy: 2,
    quantity: 2,
    description: '所在星系接收广播后可不做回应',
    image: monitoringStationSvg,
    extended: { ability: 'detect_broadcast', duration: 'permanent' },
  },
  {
    id: 'facility_lightspeed_ship',
    name: '光速飞船',
    type: 'facility',
    energy: 10,
    quantity: 2,
    description: '普通模式：一次性牌，从手牌直接跃迁，随机10能量（位置不公开）或指定13能量（位置公开），不可携带能量，无留言，跃迁后进弃牌堆；余下能量与设施可选遗留或销毁。文明遗迹模式：可重复使用，部署10能量后跃迁（随机3/指定5能量），可携带0-5能量，可留言（+1能量），飞船保留。',
    image: lightspeedShipSvg,
    extended: { ability: 'escape', duration: 'permanent' },
  },
];

export const TOTAL_CARDS = CARD_DEFINITIONS.reduce((sum, def) => sum + def.quantity, 0);

/**
 * 按 defId 查找本地内联 SVG URL。
 * Vite 自动将 <10KB 的 SVG 内联为 base64 data URI，零网络请求。
 * 用于替代后端 card.image 字段（该字段将废弃）。
 */
export const CARD_IMAGE_MAP: Record<string, string> = Object.fromEntries(
  CARD_DEFINITIONS.map(def => [def.id, def.image])
);

/**
 * 按 defId 对卡牌进行分组，用于门牌堆叠显示。
 * 保持首次出现顺序，每组返回代表卡牌（首张）和数量。
 */
export function groupCardsByDefId(cards: Card[]): Array<{ card: Card; count: number }> {
  const groups = new Map<string, { card: Card; count: number }>();
  const order: string[] = [];
  for (const card of cards) {
    const existing = groups.get(card.defId);
    if (existing) {
      existing.count += 1;
    } else {
      groups.set(card.defId, { card, count: 1 });
      order.push(card.defId);
    }
  }
  return order.map((defId) => groups.get(defId)!);
}
