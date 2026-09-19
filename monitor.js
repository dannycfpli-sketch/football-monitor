/**
 * 高精度足球賽事即時雷達（跑在 GitHub Actions 雲端）
 *
 * 規則：
 *  1. 拉取全球進行中的比賽（RapidAPI Free API Live Football Data，底層 FotMob）
 *  2. 篩選「比分 0:0 且比賽進行時間落在 50~52 分鐘」的比賽
 *  3. 每有一場符合條件的賽事，立即單獨推送（絕不批量）
 *  4. 透過 Server酱（方糖）推到微信服務號通知
 *
 * 推送格式（繁體中文，逐字固定）：
 *   【50分鐘零比零雷達】
 *   • 賽事：[主隊全稱] vs [客隊全稱]
 *   • 當前時間：第 XX 分鐘
 *   • 當前比分：0:0
 *
 * 環境變數（GitHub 倉庫 Settings → Secrets）：
 *   RAPIDAPI_KEY  = RapidAPI 的 X-RapidAPI-Key
 *   SCT_SENDKEY   = Server酱 的 SendKey（SCT 開頭）
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const KEY = process.env.RAPIDAPI_KEY;
const SENDKEY = process.env.SCT_SENDKEY;
const TRIGGER_MIN = 50; // 觸發下限（分鐘）
const TRIGGER_MAX = 52; // 觸發上限（分鐘）
const PUSHED_FILE = path.join(__dirname, 'pushed.json');

// ---------------------------------------------------------------------------
// 隊名繁體中文對照表（英文名 → 繁體中文）
// 資料源只回傳英文隊名，此表用於轉換為繁體中文；未收錄者保留原文。
// ---------------------------------------------------------------------------
const TEAM_ZH = {
  // === 英超 ===
  'Manchester City': '曼城', 'Arsenal': '阿仙奴', 'Liverpool': '利物浦',
  'Manchester United': '曼聯', 'Chelsea': '車路士', 'Tottenham Hotspur': '熱刺',
  'Newcastle United': '紐卡素', 'Aston Villa': '阿士東維拉', 'Brighton & Hove Albion': '白禮頓',
  'Brighton': '白禮頓', 'West Ham United': '韋斯咸', 'West Ham': '韋斯咸',
  'Everton': '愛華頓', 'Brentford': '賓福特', 'Fulham': '富咸',
  'Crystal Palace': '水晶宮', 'Wolverhampton Wanderers': '狼隊', 'Wolves': '狼隊',
  'Bournemouth': '般尼茅夫', 'Nottingham Forest': '諾定咸森林', 'Leeds United': '列斯聯',
  'Hull City': '侯城', 'Sunderland': '新特蘭', 'Leicester City': '李斯特城',
  'Ipswich Town': '葉士域治', 'Southampton': '修咸頓',
  // === 西甲 ===
  'Real Madrid': '皇家馬德里', 'Barcelona': '巴塞隆拿', 'Atletico Madrid': '馬德里體育會',
  'Atlético Madrid': '馬德里體育會', 'Sevilla': '西維爾', 'Real Sociedad': '皇家蘇斯達',
  'Real Betis': '貝迪斯', 'Valencia': '華倫西亞', 'Villarreal': '維拉利爾',
  'Athletic Club': '畢爾包', 'Athletic Bilbao': '畢爾包', 'Girona': '基羅納',
  'Celta Vigo': '切爾達', 'Osasuna': '奧沙辛拿', 'Getafe': '基達菲',
  'Rayo Vallecano': '華歷簡奴', 'Mallorca': '馬略卡', 'Las Palmas': '拉斯彭馬斯',
  'Espanyol': '愛斯賓奴', 'Elche': '艾爾切', 'Alavés': '艾拉維斯', 'Alaves': '艾拉維斯',
  'Leganes': '雷加利斯', 'Valladolid': '華拉度列', 'Malaga': '馬拉加', 'Málaga': '馬拉加',
  // === 意甲 ===
  'Juventus': '祖雲達斯', 'Inter Milan': '國際米蘭', 'Inter': '國際米蘭',
  'AC Milan': 'AC米蘭', 'Milan': 'AC米蘭', 'Napoli': '拿玻里',
  'Roma': '羅馬', 'Lazio': '拉素', 'Atalanta': '阿特蘭大',
  'Fiorentina': '費倫天拿', 'Bologna': '博洛尼亞', 'Torino': '拖連奴',
  'Udinese': '烏甸尼斯', 'Genoa': '熱拿亞', 'Parma': '帕爾馬',
  'Como': '科木', 'Cagliari': '卡利亞里', 'Hellas Verona': '維羅納', 'Verona': '維羅納',
  'Lecce': '萊切', 'Monza': '蒙沙', 'Empoli': '安玻里', 'Venezia': '威尼斯',
  // === 德甲 ===
  'Bayern Munich': '拜仁慕尼黑', 'FC Bayern München': '拜仁慕尼黑', 'Borussia Dortmund': '多蒙特',
  'RB Leipzig': 'RB萊比錫', 'Bayer Leverkusen': '利華古遜', 'Bayer 04 Leverkusen': '利華古遜',
  'Eintracht Frankfurt': '法蘭克福', 'Borussia Mönchengladbach': '慕遜加柏',
  'Borussia Monchengladbach': '慕遜加柏', 'VfB Stuttgart': '史特加', 'Stuttgart': '史特加',
  'VfL Wolfsburg': '禾夫斯堡', 'Wolfsburg': '禾夫斯堡', 'SC Freiburg': '弗賴堡', 'Freiburg': '弗賴堡',
  'TSG Hoffenheim': '賀芬咸', 'Hoffenheim': '賀芬咸', '1. FC Union Berlin': '柏林聯', 'Union Berlin': '柏林聯',
  'Werder Bremen': '雲達不來梅', 'FC Augsburg': '奧格斯堡', 'Augsburg': '奧格斯堡',
  '1. FSV Mainz 05': '緬恩斯', 'Mainz': '緬恩斯', '1. FC Heidenheim': '海登咸', 'Heidenheim': '海登咸',
  'FC St. Pauli': '聖保利', 'St. Pauli': '聖保利', 'Holstein Kiel': '基爾',
  'VfL Bochum': '波琴', 'Bochum': '波琴', 'Darmstadt': '達斯泰特', 'SV Darmstadt 98': '達斯泰特',
  // === 法甲 ===
  'Paris Saint-Germain': '巴黎聖日耳門', 'PSG': '巴黎聖日耳門', 'Marseille': '馬賽',
  'Monaco': '摩納哥', 'Lyon': '里昂', 'Olympique Lyonnais': '里昂',
  'Lille': '里爾', 'LOSC Lille': '里爾', 'Nice': '尼斯', 'OGC Nice': '尼斯',
  'Lens': '朗斯', 'RC Lens': '朗斯', 'Rennes': '雷恩', 'Stade Rennais': '雷恩',
  'Nantes': '南特', 'Strasbourg': '斯特拉斯堡', 'Montpellier': '蒙彼利埃',
  'Toulouse': '圖盧茲', 'Reims': '蘭斯', 'Brest': '比斯特', 'Auxerre': '歐塞爾',
  'Le Havre': '勒哈弗爾', 'Angers': '昂熱', 'Saint-Etienne': '聖伊天', 'Saint-Étienne': '聖伊天',
  // === 歐戰常客 ===
  'Benfica': '賓菲加', 'Porto': '波圖', 'Sporting CP': '士砵亭', 'Sporting Lisbon': '士砵亭',
  'Ajax': '阿積士', 'PSV': '燕豪芬', 'PSV Eindhoven': '燕豪芬', 'Feyenoord': '飛燕諾',
  'Celtic': '些路迪', 'Rangers': '格拉斯哥流浪', 'Galatasaray': '加拉塔沙雷',
  'Fenerbahce': '費倫巴治', 'Fenerbahçe': '費倫巴治', 'Besiktas': '比錫達斯', 'Beşiktaş': '比錫達斯',
  'Shakhtar Donetsk': '薩克達', 'Dynamo Kyiv': '基輔戴拿模', 'Zenit': '辛尼特',
  'Club Brugge': '布魯日', 'Anderlecht': '安德列治', 'Copenhagen': '哥本哈根',
  'Salzburg': '薩爾斯堡', 'Red Bull Salzburg': '薩爾斯堡', 'Slavia Prague': '布拉格斯拉維亞',
  'Sparta Prague': '布拉格斯巴達', 'Dinamo Zagreb': '薩格勒布戴拿模', 'Olympiacos': '奧林比亞高斯',
  'Panathinaikos': '彭拿典奈高斯', 'PAOK': 'PAOK沙朗歷基', 'Young Boys': '年青人',
  'Basel': '巴素利', 'Ferencvaros': '費倫斯華路士', 'Ferencváros': '費倫斯華路士',
  // === 中超 ===
  'Shanghai Port': '上海海港', 'Shandong Taishan': '山東泰山', 'Beijing Guoan': '北京國安',
  'Shanghai Shenhua': '上海申花', 'Chengdu Rongcheng': '成都蓉城', 'Tianjin Jinmen Tiger': '天津津門虎',
  'Zhejiang Professional': '浙江隊', 'Zhejiang': '浙江隊', 'Wuhan Three Towns': '武漢三鎮',
  'Henan': '河南隊', 'Qingdao West Coast': '青島西海岸', 'Qingdao Hainiu': '青島海牛',
  'Cangzhou Mighty Lions': '滄州雄獅', 'Meizhou Hakka': '梅州客家', 'Changchun Yatai': '長春亞泰',
  'Nantong Zhiyun': '南通支雲', 'Nantong Zhiyun FC': '南通支雲', 'Dalian K\'un City': '大連鯤城',
  'Dalian Kun City': '大連鯤城', 'Chongqing Tongliang Long': '重慶銅梁龍', 'Guangxi Hengchen': '廣西恆宸',
  'Ningbo Professional': '寧波隊', 'Yanbian Longding': '延邊龍鼎', 'Guangdong Guangzhou Bao': '廣東廣州豹',
  'Shenzhen Peng City': '深圳新鵬城', 'Liaoning Tieren': '遼寧鐵人', 'Yunnan Yukun': '雲南玉昆',
  // === 日職 / 日乙 ===
  'Kashima Antlers': '鹿島鹿角', 'Urawa Reds': '浦和紅鑽', 'Kawasaki Frontale': '川崎前鋒',
  'Yokohama F. Marinos': '橫濱水手', 'Vissel Kobe': '神戶勝利船', 'FC Tokyo': 'FC東京',
  'Gamba Osaka': '大阪飛腳', 'Cerezo Osaka': '大阪櫻花', 'FC Osaka': 'FC大阪',
  'Nagoya Grampus': '名古屋鯨魚', 'Sanfrecce Hiroshima': '廣島三箭', 'Kashiwa Reysol': '柏雷素爾',
  'Avispa Fukuoka': '福岡黃蜂', 'Kyoto Sanga': '京都不死鳥', 'Sagan Tosu': '鳥棲砂岩',
  'Albirex Niigata': '新潟天鵝', 'Shonan Bellmare': '湘南比馬', 'Jubilo Iwata': '磐田山葉',
  'Fukushima United': '福島聯', 'Kumamoto': '熊本', 'Roasso Kumamoto': '熊本深紅',
  'Matsumoto Yamaga': '松本山雅', 'Shimizu S-Pulse': '清水心跳', 'Tokyo Verdy': '東京綠茵',
  'Ventforet Kofu': '甲府風林', 'JEF United Chiba': '千葉市原', 'Omiya Ardija': '大宮松鼠',
  'Vegalta Sendai': '仙台七夕', 'Montedio Yamagata': '山形山神',
  // === K聯賽 ===
  'Jeonbuk Hyundai Motors': '全北現代', 'Jeonbuk': '全北現代', 'Ulsan HD': '蔚山現代',
  'Ulsan Hyundai': '蔚山現代', 'FC Seoul': 'FC首爾', 'Pohang Steelers': '浦項制鐵',
  'Suwon Samsung Bluewings': '水原三星', 'Incheon United': '仁川聯', 'Gangwon FC': '江原FC',
  'Gwangju FC': '光州FC', 'Daegu FC': '大邱FC', 'Daejeon Hana Citizen': '大田韓亞市民',
  'Jeju United': '濟州聯', 'Gimcheon Sangmu': '金泉尚武', 'Anyang': '安養',
  // === 沙特 / 澳超 ===
  'Al Hilal': '希拉爾', 'Al-Hilal': '希拉爾', 'Al Nassr': '艾納斯', 'Al-Nassr': '艾納斯',
  'Al Ittihad': '伊蒂哈德', 'Al-Ittihad': '伊蒂哈德', 'Al Ahli': '艾阿里', 'Al-Ahli': '艾阿里',
  'Al Shabab': '艾沙比', 'Al-Shabab': '艾沙比', 'Al Fateh': '艾法特', 'Al-Fateh': '艾法特',
  'Al Ettifaq': '艾達法', 'Al-Ettifaq': '艾達法', 'Al Taawoun': '艾塔亞文', 'Al-Taawoun': '艾塔亞文',
  'Melbourne City': '墨爾本城', 'Sydney FC': '悉尼FC', 'Melbourne Victory': '墨爾本勝利',
  'Western Sydney Wanderers': '西悉尼流浪者', 'Adelaide United': '阿德萊德聯', 'Brisbane Roar': '布里斯班獅吼',
  'Perth Glory': '珀斯光輝', 'Central Coast Mariners': '中岸水手', 'Wellington Phoenix': '威靈頓鳳凰',
  'Newcastle Jets': '紐卡素噴射機', 'Auckland FC': '奧克蘭FC',
  // === 美洲 ===
  'Flamengo': '法林明高', 'Palmeiras': '彭美拉斯', 'Corinthians': '哥連泰斯',
  'Sao Paulo': '聖保羅', 'São Paulo': '聖保羅', 'Santos': '山度士', 'Botafogo': '保地花高',
  'Fluminense': '富明尼斯', 'Gremio': '甘美奧', 'Grêmio': '甘美奧', 'Internacional': '國際體育會',
  'River Plate': '河床', 'Boca Juniors': '小保加', 'Independiente': '獨立隊',
  'Racing Club': '競賽會', 'LA Galaxy': '洛杉磯銀河', 'Inter Miami': '國際邁亞密',
  'Club America': '阿美利加', 'Club América': '阿美利加', 'Cruz Azul': '藍十字',
  'Chivas': '瓜達拉哈拉', 'Guadalajara': '瓜達拉哈拉', 'Monterrey': '蒙特雷', 'Tigres': '堤格雷斯',
  // === 國家隊 / 青年隊 ===
  'Saudi Arabia U23': '沙特阿拉伯U23', 'Qatar U23': '卡塔爾U23', 'Uzbekistan U23': '烏茲別克U23',
  'Kuwait U23': '科威特U23', 'South Korea U23': '南韓U23', 'Japan U23': '日本U23',
  'China U23': '中國U23', 'Iran U23': '伊朗U23', 'Iraq U23': '伊拉克U23',
  'Birmingham U21': '伯明翰U21', 'Arsenal U21': '阿仙奴U21', 'Manchester United U21': '曼聯U21',
  'Liverpool U21': '利物浦U21', 'Chelsea U21': '車路士U21', 'Tottenham U21': '熱刺U21',
  // === 其他常見 ===
  'Chornomorets Odesa': '敖德薩黑海人', 'Obolon Kyiv': '奧布隆基輔', 'Irtysh Pavlodar': '額爾齊斯巴甫洛達爾',
  'Okzhetpes Kokshetau': '奧克澤特佩斯', 'Zhenis': '熱尼斯', 'Zhetysu Taldykorgan': '傑特蘇',
  'Kaspiy Aktau': '卡斯皮阿克套', 'FC Altai Oskemen': '阿爾泰厄斯克門', 'Madura United': '馬都拉聯',
  'PSIM Yogyakarta': 'PSIM日惹', 'Hougang United FC': '後港聯', 'FC Jurong': '裕廊FC',
  'Ayutthaya United FC': '阿瑜陀耶聯', 'Uthai Thani FC': '烏泰他尼',
  'Binh Dinh': '平定', 'Bình Định': '平定', 'Cong An Ha Noi': '公安河內', 'Công An Hà Nội': '公安河內',
  // === 英冠 ===
  'Sheffield United': '錫菲聯', 'Sheffield Wednesday': '錫周三', 'Middlesbrough': '米杜士堡',
  'Blackburn Rovers': '布力般流浪', 'Watford': '屈福特', 'Norwich City': '諾域治',
  'Coventry City': '高雲地利', 'Millwall': '米禾爾', 'Preston North End': '普雷斯頓',
  'Swansea City': '史雲斯', 'Cardiff City': '卡迪夫城', 'Stoke City': '史篤城',
  'Bristol City': '布里斯托城', 'West Bromwich Albion': '西布朗', 'West Brom': '西布朗',
  'Derby County': '打比郡', 'Plymouth Argyle': '普利茅夫', 'Oxford United': '牛津聯',
  'Luton Town': '盧頓', 'Portsmouth': '樸茨茅夫', 'Stockport County': '斯托克港',
  'Queens Park Rangers': '昆士柏流浪', 'QPR': '昆士柏流浪', 'Birmingham City': '伯明翰城',
  // === 英甲 ===
  'Barnsley': '班士利', 'Bolton Wanderers': '保頓', 'Charlton Athletic': '查爾頓',
  'Leyton Orient': '萊頓東方', 'Wigan Athletic': '韋根', 'Wycombe Wanderers': '韋甘比',
  'Reading': '雷丁', 'Peterborough United': '彼德堡', 'Blackpool': '黑池',
  'Huddersfield Town': '哈特斯菲爾德', 'Rotherham United': '洛達咸', 'Lincoln City': '林肯城',
  'Cambridge United': '劍橋聯', 'Doncaster Rovers': '唐卡士打', 'Stevenage': '史提芬納治',
  'Exeter City': '埃克塞特', 'Shrewsbury Town': '梳士貝利', 'Burton Albion': '保頓艾爾賓',
  'Mansfield Town': '曼斯菲特', 'Northampton Town': '諾咸頓', 'Crawley Town': '克勞利',
  'Bristol Rovers': '布里斯托流浪者', 'Wrexham': '域斯咸',
  // === 英乙 / 全國聯 ===
  'Gillingham': '基寧咸', 'Salford City': '沙福特城', 'Swindon Town': '史雲頓',
  'Bradford City': '巴拉福特', 'Notts County': '諾士郡', 'Crewe Alexandra': '克魯',
  'Cheltenham Town': '車頓咸', 'Colchester United': '高車士打', 'Fleetwood Town': '費列活特',
  'Tranmere Rovers': '燦美爾', 'Newport County': '新港', 'Accrington Stanley': '阿克寧頓',
  'Barrow': '巴羅', 'AFC Wimbledon': 'AFC溫布頓', 'Carlisle United': '卡素爾',
  'Grimsby Town': '甘士比', 'Harrogate Town': '哈羅蓋特', 'Morecambe': '摩甘比',
  'Milton Keynes Dons': '米爾頓凱恩斯', 'Walsall': '華素爾', 'Port Vale': '維爾港',
  'Chesterfield': '車士打菲特', 'Barnet': '班列特', 'York City': '約克城',
  'Southend United': '紹森德', 'Bromley': '布羅姆利', 'AFC Fylde': '菲爾德',
  'Aldershot Town': '奧爾德肖特', 'Altrincham': '奧特靈厄姆', 'Sutton United': '瑟頓聯',
  'Boston United': '波士頓聯', 'Forest Green Rovers': '綠色森林流浪者', 'Woking': '禾京',
  'Kidderminster Harriers': '基德明斯特', 'Eastleigh': '伊斯特利', 'Boreham Wood': '博勒姆伍德',
  'Gateshead': '蓋茨黑德', 'FC Halifax Town': '哈利法克斯',
  // === 蘇格蘭 ===
  'Aberdeen': '鴨巴甸', 'Hearts': '赫斯', 'Heart of Midlothian': '赫斯', 'Hibernian': '喜伯年',
  'Dundee': '登地', 'Dundee United': '登地聯', 'Motherwell': '馬瑟韋爾',
  'St. Johnstone': '聖莊士東', 'St Johnstone': '聖莊士東', 'St. Mirren': '聖美倫', 'St Mirren': '聖美倫',
  'Ross County': '羅斯郡', 'Kilmarnock': '基爾馬諾克', 'Livingston': '利雲斯頓',
  'Falkirk': '福爾柯克', 'Partick Thistle': '巴特里', 'Raith Rovers': '雷夫流浪',
  'Dunfermline Athletic': '登弗姆林', 'Greenock Morton': '格里諾克摩頓', 'Airdrieonians': '艾迪爾聯',
  'Montrose': '蒙特羅斯', 'East Fife': '東法夫', 'Hamilton Academical': '咸美頓',
  'Queen of the South': '南部女王', 'Peterhead': '彼得黑德', 'Alloa Athletic': '阿洛厄',
  'Stenhousemuir': '史丹侯斯姆爾', 'Arbroath': '阿布羅斯', 'Cove Rangers': '科夫流浪',
  'Elgin City': '埃爾金城', 'Dumbarton': '鄧巴頓', 'Stirling Albion': '斯特靈艾爾比恩',
  'Forfar Athletic': '福法爾', 'Annan Athletic': '安南', 'Kelty Hearts': '凱爾蒂赫斯',
  'Edinburgh City': '愛丁堡城', 'Clyde': '克萊德', 'Buckie Thistle': '巴基',
  'Nairn County': '奈恩郡', 'Formartine United': '福馬泰恩聯', 'Rothes': '羅西斯',
  'Brora Rangers': '布羅拉流浪', 'Wick Academy': '威克學院', 'Fraserburgh': '弗雷澤堡',
  'Lossiemouth': '洛西茅斯', 'Invergordon': '因弗戈登', 'Turriff United': '特里夫聯',
  'Deveronvale': '德弗倫韋爾', 'Huntly': '亨特利', 'Clachnacuddin': '克拉赫納庫丁',
  'Inverurie Loco Works': '因弗魯里火車頭',
  // === 土耳其 ===
  'Trabzonspor': '特拉布宗', 'Basaksehir': '巴沙克舒希', 'İstanbul Başakşehir': '巴沙克舒希',
  'Kocaelispor': '科賈埃利', 'Gaziantep FK': '加濟安泰普', 'Gaziantep': '加濟安泰普',
  'Sivasspor': '錫瓦斯', 'Boluspor': '博盧', 'Çorum FK': '喬魯姆', 'Alanyaspor': '阿拉尼亞',
  'Keçiörengücü': '凱奇厄倫古庫', 'Sarıyer': '薩勒耶爾',
  // === 瑞典 / 北歐 ===
  'Malmö FF': '馬模', 'Malmo FF': '馬模', 'AIK': 'AIK蘇納', 'Djurgården': '佐加頓斯',
  'Djurgarden': '佐加頓斯', 'Hammarby': '哈馬比', 'IFK Göteborg': '哥登堡', 'IFK Goteborg': '哥登堡',
  'Helsingborg': '希爾星堡', 'FBK Karlstad': '卡爾斯塔德', 'Sollentuna FK': '索倫蒂納',
  'Sandvikens IF': '山特維肯', 'Örebro': '厄勒布魯', 'Orebro': '厄勒布魯',
};

// 英文名 → 繁體中文（優先精確匹配，其次去除常見後綴後匹配）
function zh(name) {
  if (!name) return '未知';
  if (TEAM_ZH[name]) return TEAM_ZH[name];
  const stripped = String(name)
    .replace(/\s*(FC|CF|SC|AC|AS|AFC|A\.C\.)\s*$/i, '')
    .replace(/\s*(United|City|Town|Club)$/i, '')
    .trim();
  if (stripped !== name && TEAM_ZH[stripped]) return TEAM_ZH[stripped];
  return name; // 未收錄者保留原文
}

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

// 拉取全球進行中的比賽
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

// 從 liveTime.short（如 "51'"）提取比賽分鐘數
function getMinute(m) {
  const s = (m.status && m.status.liveTime && m.status.liveTime.short) || '';
  const mm = String(s).match(/\d+/);
  return mm ? parseInt(mm[0], 10) : null;
}

// 判斷是否進行中（Live）
function isLive(m) {
  const st = m.status || {};
  return st.ongoing === true || st.started === true;
}

// 透過 Server酱 推送到微信
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
    console.error('缺少環境變數 RAPIDAPI_KEY 或 SCT_SENDKEY');
    process.exit(1);
  }

  const pushed = loadPushed();
  const live = await getLiveMatches();

  // 篩選硬條件：Live 進行中 + 比分 0:0 + 時間落在 50~52 分鐘
  const hits = live.filter((m) => {
    const mn = getMinute(m);
    const homeScore = m.home && m.home.score;
    const awayScore = m.away && m.away.score;
    const is00 = homeScore === 0 && awayScore === 0;
    return isLive(m) && is00 && mn !== null && mn >= TRIGGER_MIN && mn <= TRIGGER_MAX;
  });

  // 去重：每場賽事只推一次
  const fresh = hits.filter((m) => !pushed[m.id]);

  if (fresh.length === 0) {
    console.log(`[${new Date().toISOString()}] 無符合 50~52 分鐘 0:0 之賽事（當前進行中 ${live.length} 場）`);
    return;
  }

  // 每場賽事獨立推送，絕不批量
  for (const m of fresh) {
    const mn = getMinute(m);
    const home = zh((m.home && m.home.name) || '');
    const away = zh((m.away && m.away.name) || '');

    const title = '【50分鐘零比零雷達】';
    const desp =
      `• 賽事：${home} vs ${away}\n` +
      `• 當前時間：第 ${mn} 分鐘\n` +
      `• 當前比分：0:0`;

    try {
      const r = await pushServerChan(title, desp);
      if (r && r.code === 0) {
        pushed[m.id] = Date.now();
        console.log(`✅ 已推送: ${home} vs ${away} (${mn}分鐘)`);
      } else {
        console.error(`推送異常 ${home} vs ${away}:`, JSON.stringify(r));
      }
    } catch (e) {
      console.error(`推送失敗 ${home} vs ${away}:`, e.message);
    }
  }

  fs.writeFileSync(PUSHED_FILE, JSON.stringify(pushed));
}

main().catch((e) => {
  console.error('執行出錯:', e.message);
  process.exit(1);
});
