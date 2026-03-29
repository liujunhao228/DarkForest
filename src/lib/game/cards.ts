// ============================
// 卡牌定义（从规则文档的YAML转换）
// ============================
import { CardDef } from './types';

export const CARD_DEFINITIONS: CardDef[] = [
  // ==================
  // 广播类卡牌 (共 28 张)
  // ==================

  // 恒星广播 (14 张：9 合作 + 5 伪装)
  {
    id: 'broadcast_star_cooperation',
    name: '恒星广播',
    type: 'broadcast',
    energy: 0,
    quantity: 9,
    description: '向距离 1 以内的星系发送广播信号，若对方回应且双方均选择合作，各获得 3 能量',
    image: '/images/broadcast/star-broadcast.svg',
    extended: {
      subtype: 'cooperation',
      range: 1,
    },
  },
  {
    id: 'broadcast_star_disguise',
    name: '恒星广播',
    type: 'broadcast',
    energy: 0,
    quantity: 5,
    description: '向距离 1 以内的星系发送广播信号，伪装方可获得 5 能量（若对方合作）',
    image: '/images/broadcast/star-broadcast.svg',
    extended: {
      subtype: 'disguise',
      range: 1,
    },
  },

  // 宇宙广播 (10 张：6 合作 + 4 伪装)
  {
    id: 'broadcast_cosmic_cooperation',
    name: '宇宙广播',
    type: 'broadcast',
    energy: 1,
    quantity: 6,
    description: '向距离 2 以内的星系发送广播信号，若对方回应且双方均选择合作，各获得 3 能量',
    image: '/images/broadcast/cosmic-broadcast.svg',
    extended: {
      subtype: 'cooperation',
      range: 2,
    },
  },
  {
    id: 'broadcast_cosmic_disguise',
    name: '宇宙广播',
    type: 'broadcast',
    energy: 1,
    quantity: 4,
    description: '向距离 2 以内的星系发送广播信号，伪装方可获得 5 能量（若对方合作）',
    image: '/images/broadcast/cosmic-broadcast.svg',
    extended: {
      subtype: 'disguise',
      range: 2,
    },
  },

  // 超距广播 (4 张：2 合作 + 2 伪装)
  {
    id: 'broadcast_ultra_cooperation',
    name: '超距广播',
    type: 'broadcast',
    energy: 2,
    quantity: 2,
    description: '无视距离发送广播信号，若对方回应且双方均选择合作，各获得 3 能量',
    image: '/images/broadcast/ultra-broadcast.svg',
    extended: {
      subtype: 'cooperation',
      range: 1000,
    },
  },
  {
    id: 'broadcast_ultra_disguise',
    name: '超距广播',
    type: 'broadcast',
    energy: 2,
    quantity: 2,
    description: '无视距离发送广播信号，伪装方可获得 5 能量（若对方合作）',
    image: '/images/broadcast/ultra-broadcast.svg',
    extended: {
      subtype: 'disguise',
      range: 1000,
    },
  },

  // ==================
  // 打击类卡牌 (共 17 张)
  // ==================

  {
    id: 'strike_thermal',
    name: '热核打击',
    type: 'strike',
    energy: 4,
    quantity: 4,
    description: '打击无特殊效果，可被掩体星环防御',
    image: '/images/strike/thermal.svg',
    extended: {
      level: 1,
      speed: 1,
    },
  },
  {
    id: 'strike_light_particle',
    name: '光粒打击',
    type: 'strike',
    energy: 6,
    quantity: 4,
    description: '无论是否被防御，均毁灭目标星系恒星',
    image: '/images/strike/light-particle.svg',
    extended: {
      level: 2,
      speed: 1,
    },
  },
  {
    id: 'strike_annihilation',
    name: '湮灭打击',
    type: 'strike',
    energy: 8,
    quantity: 3,
    description: '无论是否被防御，均毁灭目标星系恒星及所有建设牌',
    image: '/images/strike/annihilation.svg',
    extended: {
      level: 3,
      speed: 1,
    },
  },
  {
    id: 'strike_dimensional',
    name: '降维打击',
    type: 'strike',
    energy: 10,
    quantity: 3,
    description: '彻底清除目标星系',
    image: '/images/strike/dimensional.svg',
    extended: {
      level: 4,
      speed: 1,
    },
  },
  {
    id: 'strike_tech_lock',
    name: '科技锁死',
    type: 'strike',
    energy: 4,
    quantity: 3,
    description: '无视防御，打击生效时，目标玩家立即弃掉全部手牌',
    image: '/images/strike/tech-lock.svg',
    extended: {
      level: 4,
      speed: 1,
      effect: 'discard_hand',
    },
  },

  // ==================
  // 防御类卡牌 (共 8 张)
  // ==================

  {
    id: 'defense_shield_ring',
    name: '掩体星环',
    type: 'defense',
    energy: 6,
    quantity: 5,
    description: '可在等级 2 及以下的打击中幸存，可防御热核打击、但不免除光粒打击的效果',
    image: '/images/defense/shield-ring.svg',
    extended: {
      protection_level: 2,
      duration: 'permanent',
    },
  },
  {
    id: 'defense_quantum_ghost',
    name: '量子幽灵',
    type: 'defense',
    energy: 8,
    quantity: 3,
    description: '进入量子幽灵态，可在等级 3 及以下的打击中幸存',
    image: '/images/defense/quantum-ghost.svg',
    extended: {
      protection_level: 3,
      duration: 'permanent',
    },
  },

  // ==================
  // 设施类卡牌 (共 19 张)
  // ==================

  {
    id: 'facility_solar_array',
    name: '太阳能阵列',
    type: 'facility',
    energy: 2,
    quantity: 5,
    description: '每回合开始时获得 1 点能量产出，依赖恒星',
    image: '/images/facility/solar-array.svg',
    extended: {
      energy_per_turn: 1,
      duration: 'permanent',
    },
  },
  {
    id: 'facility_fusion_reactor',
    name: '聚变反应堆',
    type: 'facility',
    energy: 3,
    quantity: 4,
    description: '每回合获得 1 点能量产出，不依赖恒星',
    image: '/images/facility/fusion-reactor.svg',
    extended: {
      energy_per_turn: 1,
      duration: 'permanent',
    },
  },
  {
    id: 'facility_antimatter_engine',
    name: '反物质引擎',
    type: 'facility',
    energy: 6,
    quantity: 3,
    description: '每回合获得 2 点能量产出，不依赖恒星',
    image: '/images/facility/antimatter-engine.svg',
    extended: {
      energy_per_turn: 2,
      duration: 'permanent',
    },
  },
  {
    id: 'facility_dyson_sphere',
    name: '戴森球',
    type: 'facility',
    energy: 6,
    quantity: 3,
    description: '每回合获得 3 点能量产出，依赖恒星，每个星系只能建造1个',
    image: '/images/facility/dyson-sphere.svg',
    extended: {
      energy_per_turn: 3,
      duration: 'permanent',
    },
  },
  {
    id: 'facility_monitoring_station',
    name: '监听基地',
    type: 'facility',
    energy: 2,
    quantity: 2,
    description: '所在星系接收广播后可不做回应',
    image: '/images/facility/monitoring-station.svg',
    extended: {
      ability: 'detect_broadcast',
      duration: 'permanent',
    },
  },
  {
    id: 'facility_lightspeed_ship',
    name: '光速飞船',
    type: 'facility',
    energy: 10,
    quantity: 2,
    description: '可跃迁至随机无文明星系，不可携带能量及建设牌，使用后弃置此牌',
    image: '/images/facility/lightspeed-ship.svg',
    extended: {
      ability: 'escape',
      duration: 'permanent',
    },
  },
];

/** 总牌数 */
export const TOTAL_CARDS = CARD_DEFINITIONS.reduce((sum, def) => sum + def.quantity, 0);
