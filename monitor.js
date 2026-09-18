/**
 * 足球 0:0 监控脚本（跑在 GitHub Actions 云端）
 * 逻辑：
 *  1. 拉取全球进行中的比赛（RapidAPI Free API Live Football Data）
 *  2. 筛选「比分 0:0 且比赛进行到 50 分钟以上」的比赛
 *  3. 去重（已推送过的比赛不再推）
 *  4. 通过 Server酱 推到微信（微信服务号通知）
 *
 * 环境变量（在 GitHub 仓库 Settings → Secrets 里配置）：
 *   RAPIDAPI_KEY  = RapidAPI 的 X-RapidAPI-Key
 *   SCT_SENDKEY   = Server酱 的 SendKey（SCT 开头）
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const KEY = process.env.RAPIDAPI_KEY;
const SENDKEY = process.env.SCT_SENDKEY;
const MIN_MINUTE = 50; // 比赛进行到多少分钟还没进球才提醒
const PUSHED_FILE = path.join(__dirname, 'pushed.json');

function request(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { resolve(d); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
  });
}

// 拉取全球进行中的比赛
async function getLiveMatches() {
  const url = 'https://free-api-live-football-data.p.rapidapi.com/football-current-live';
  const headers = {
    'x-rapidapi-key': KEY,
    'x-rapidapi-host': 'free-api-live-football-data.p.rapidapi.com',
    'User-Agent': 'football-monitor/1.0',
  };
  const j = await request(url, headers);
  return (j && j.response && j.response.live) || [];
}

// 从 liveTime.short（如 "65'"）里提取比赛分钟数
function getMinute(m) {
  const s = (m.status && m.status.liveTime && m.status.liveTime.short) || '';
  const mm = String(s).match(/\d+/);
  return mm ? parseInt(mm[0], 10) : null;
}

// 通过 Server酱 推送到微信（微信服务号通知）
function pushServerChan(title, desp) {
  return new Promise((resolve, reject) => {
    const url = `https://sc.ftqq.com/${SENDKEY}.send`;
    const body = `title=${encodeURIComponent(title)}&desp=${encodeURIComponent(desp)}`;
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'football-monitor/1.0',
      },
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { resolve(d); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    req.write(body);
    req.end();
  });
}

function loadPushed() {
  try {
    if (fs.existsSync(PUSHED_FILE)) return JSON.parse(fs.readFileSync(PUSHED_FILE, 'utf8'));
  } catch (e) {}
  return {};
}

async function main() {
  if (!KEY || !SENDKEY) {
    console.error('缺少环境变量 RAPIDAPI_KEY 或 SCT_SENDKEY');
    process.exit(1);
  }

  const pushed = loadPushed();
  const live = await getLiveMatches();

  // 筛选：0:0 且 >= 50 分钟
  const hits = live.filter((m) => {
    const mn = getMinute(m);
    const homeScore = m.home && m.home.score;
    const awayScore = m.away && m.away.score;
    const is00 = homeScore === 0 && awayScore === 0;
    return is00 && mn !== null && mn >= MIN_MINUTE;
  });

  // 去重：只推没推过的
  const fresh = hits.filter((m) => !pushed[m.id]);

  if (fresh.length === 0) {
    console.log(`[${new Date().toISOString()}] 无新增 0:0≥${MIN_MINUTE} 比赛（当前进行中 ${live.length} 场）`);
    return;
  }

  for (const m of fresh) {
    const mn = getMinute(m);
    const home = (m.home && m.home.name) || '?';
    const away = (m.away && m.away.name) || '?';
    const title = `⚽ 0:0 已到 ${mn} 分钟：${home} vs ${away}`;
    const desp = `${home} **0-0** ${away}\n\n比赛已进行到 **${mn} 分钟**，比分仍为 0:0。`;
    try {
      const r = await pushServerChan(title, desp);
      // Server酱 code=0 表示成功
      if (r && r.code === 0) {
        pushed[m.id] = Date.now();
        console.log(`✅ 已推送: ${home} vs ${away} (${mn}分钟)`);
      } else {
        console.error(`推送异常 ${home} vs ${away}:`, JSON.stringify(r));
      }
    } catch (e) {
      console.error(`推送失败 ${home} vs ${away}:`, e.message);
    }
  }

  fs.writeFileSync(PUSHED_FILE, JSON.stringify(pushed));
}

main().catch((e) => {
  console.error('执行出错:', e.message);
  process.exit(1);
});
