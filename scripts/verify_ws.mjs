// 验证脚本：复刻扩展的 WS 握手 + 登录流程，打印服务端真实响应
const token = process.argv[2];
const url = process.env.DARKFOREST_WS_URL || 'ws://localhost:8080/ws';

if (!token) {
  console.error('用法: node verify_ws.mjs <JWT>');
  process.exit(1);
}

console.log('连接:', url);
console.log('token 前缀:', token.slice(0, 12), '... 长度:', token.length);

const ws = new WebSocket(url, token); // 子协议 = token（与前端口一致）

const log = (...a) => console.log(new Date().toISOString(), ...a);

ws.addEventListener('open', () => {
  log('✅ open (readyState=1)');
  // 前端口会在连接后发 player:login；服务端其实连这个都不需要就直接推 loginSuccess
  ws.send(JSON.stringify({ type: 'player:login', payload: { displayName: 'Pi-Agent' } }));
  log('→ 已发送 player:login');
});

ws.addEventListener('message', (ev) => {
  let msg;
  try {
    msg = JSON.parse(ev.data);
  } catch {
    log('← 非 JSON:', String(ev.data).slice(0, 200));
    return;
  }
  log('← 收到消息 type=', msg.type, 'payload=', JSON.stringify(msg.payload)?.slice(0, 300));
});

ws.addEventListener('error', (ev) => {
  log('❌ error', ev.message || ev.error || ev);
});

ws.addEventListener('close', (ev) => {
  log('🔒 close code=', ev.code, 'reason=', ev.reason || '(空)');
  process.exit(0);
});

// 5 秒后主动关闭
setTimeout(() => {
  log('⏱ 超时未收到预期消息，主动关闭');
  ws.close(1000, 'test done');
}, 5000);
