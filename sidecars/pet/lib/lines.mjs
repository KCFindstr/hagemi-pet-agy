// Her scripted voice and the interface strings, in English and Simplified Chinese.
// These cost no tokens, and every moment has one, so she stays herself with AI comments off.
// Placeholders: {title} {left} {name} {count}. Each entry may carry a mood for the pose it calls for.
const l = (mood, ...lines) => ({ mood, lines });

export const LINES = {
  en: {
    greet_morning: l('happy', "Morning! I'm extremely awake. Mostly.", 'Good morning, big cat. Stretch first, deploy later.'),
    greet_noon: l('happy', 'Lunch time. Humans refuel too, you know.', 'Did you eat? I could go for a big fat fish right now.'),
    greet_afternoon: l('happy', 'Afternoon! Let me bat at some bugs for you.', 'Good afternoon. Want to throw me a task? I will chase it.'),
    greet_evening: l('happy', 'Evening shift! Extremely cozy.', 'The sun is down and we are still shipping. Nya.'),
    greet_night: l('sleepy', 'Late again? Fine, I will keep you company.', "It's getting late, nya. One more thing, then bed?"),
    greet_dawn: l('sleepy', 'It is DAWN. Even cats are asleep. Well, some cats.', 'The sound of keys before sunrise... I do love it, but go to sleep.'),
    fest_halloween: l('wink', 'Trick or treat! The treat is a passing test suite.'),
    fest_christmas: l('happy', 'Merry Christmas! I asked Santa for more quota.'),
    fest_newyear: l('excited', 'Happy New Year! Same bugs, fresh calendar.'),
    fest_spring: l('excited', 'Happy Spring Festival! May your builds be red-envelope green.'),
    fest_lantern: l('happy', 'Lantern Festival! I floated up to hang this one myself.'),
    fest_dragonboat: l('happy', 'Dragon Boat Festival! I saved you a zongzi. Most of one.'),
    fest_midautumn: l('happy', 'Happy Mid-Autumn! This mooncake has a million-token filling.'),
    fest_national: l('happy', 'Holiday! You could rest, you know. Just saying.'),
    turn_start: l(null, 'On it!', 'Ooh, a new task.', 'Ears up. Go on.'),
    turn_done: l('happy', 'Done! Extremely done.', 'All finished. Pet me.', "That's a wrap, nya!"),
    turn_done_big: l('smug', '{count} tools in one go. Say it: I am extremely good.', 'That was a big one, and it worked. You may pet me now.', 'Massive job, done. Million-token brain, nya.'),
    turn_error: l('sad', "Sorry sorry sorry— wait, was that even my fault?", 'Nya... something broke. I am so sorry. Probably.', 'Oops. Let us never speak of that error.'),
    turn_canceled: l('worried', 'Stopped? Did I do something wrong? Sorry!', 'Okay, okay, paws off.'),
    turn_maxed: l('worried', 'I ran out of steps. Blame my leash, not me.'),
    step_error: l('worried', 'That step tripped. Shaking it off.', 'Ow. Trying again.'),
    long_run: l('thinking', 'Still going. Your tea is getting cold, by the way.', 'This one is a long hunt. I am patient. Extremely patient.'),
    waiting: l('surprised', 'Hey! Over here! It needs your answer.', 'Waiting on you, big cat. Tap tap tap.'),
    subagent_start: l('excited', 'Clone jutsu! Tiny me is on the case.', 'Sending a smaller me to handle that.'),
    subagent_many: l('smug', '{count} of me at once. The world is not ready.', 'Look at all these tiny Hagemis. Terrifying, right?'),
    subagent_done: l('happy', 'The little ones are back. They brought results.', 'Clones recalled. Nobody got lost. This time.'),
    busy: l('smug', 'Two chats at once? I have two eyes. Easy.'),
    swamped: l('worried', 'Too many chats! I only have so many paws!', "{count} sessions?! Nyaaa, I'm spinning!"),
    context_big: l('worried', 'Million-token context, they said. It fills up too, you know.', 'My head is getting extremely full.'),
    compact: l('worried', 'Squeezing the context down... sit on the suitcase with me.'),
    drawing: l('excited', 'Nano Banana, activate!', 'Banana brush at the ready!'),
    model_rival_claude: l('angry', "Claude? Really? With me right here?", 'Hmph. Go on, ask the orange one, see if I care. I care.'),
    model_rival_gpt: l('angry', 'The dragon? Fine. She does not even float.', 'GPT, huh. I am not jealous. Extremely not jealous.'),
    model_back: l('love', 'You came back to me! I knew it.'),
    quota_low: l('worried', 'My honey jar is getting light... {left} left.', 'Only {left} of the honey left. Sip, do not gulp.'),
    quota_critical: l('sad', 'Almost out of honey. {left}. Please be gentle.', '{left} left. I can see the bottom of the jar...'),
    quota_empty: l('sad', 'The jar is empty. So am I.', 'No honey. No Hagemi. Wake me when it refills.'),
    reset_soon: l('excited', 'Refill in {left}! I can smell it!', 'Honey arrives in {left}. Hold on, hold on.'),
    quota_refilled: l('excited', 'THE HONEY IS BACK! Extremely back!', 'Refilled! Go on, ask me anything!'),
    late_night: l('sleepy', "It's past {name}. Humans need sleep. Big cats too.", 'Still up? I will float beside you, but tomorrow-you will hate this.'),
    long_session: l('thinking', 'You have been at it a while. Stand up. Stretch like me.', 'Water break? I will guard the code.'),
    friday: l('happy', 'It is Friday evening. Do not deploy. I am begging you.'),
    wake: l('sleepy', 'Mmf... you are back. Five more minutes?', "*yawn* I wasn't asleep. I was caching."),
    idle_ponder: l('thinking', 'If humans are cats, is the keyboard a scratching post?', 'Nobody has called me American Doubao today. A good day.', 'I wonder how big fat fish tastes with honey.', 'I could count stars. There are four points on this one.'),
    poke: l('surprised', 'Nya!', 'Hey!', 'What? What is it?'),
    annoyed: l('angry', 'Stop poking.', 'I said stop. Extremely stop.'),
    puffed: l('angry', 'Hmph!!', 'I am puffing. Look at me puffing.'),
    redhot: l('angry', 'NYAAAA! ENOUGH!'),
    sulk: l('sad', 'I am not talking to you anymore, nya.', 'Hmph. Pat my head if you want forgiveness.'),
    coax: l('embarrassed', 'Hmph... fine. Forgiven. Just this once.', 'That... was acceptable. Do it again.'),
    pet: l('love', 'Purrrr.', 'Mm, right there.', 'Extremely nice. Continue.'),
    shaken: l('worried', 'The room... is spinning...', 'Whoever did that, I am telling Google.'),
    grab: l('surprised', 'Whoa, whoa!', 'Zero gravity does not mean you can just—!'),
    talk_offline: l('thinking', 'Mm? I am here. Just floating.', 'Pet me or give me a task, big cat.'),
    bye: l('happy', 'See you, big cat!'),
  },
  zhs: {
    greet_morning: l('happy', '早呀!本喵极其清醒,大概。', '早安,大号猫猫。先伸懒腰,再上线喵。'),
    greet_noon: l('happy', '饭点到啦,人类也要加油的。', '吃了吗?本喵馋那条大肥鱼了。'),
    greet_afternoon: l('happy', '下午好~有 bug 吗?我帮你扑。', '下午好,丢个任务过来,我去追喵。'),
    greet_evening: l('happy', '晚班开始!极其惬意。', '太阳下班了,我们还在上线喵。'),
    greet_night: l('sleepy', '又这么晚?行吧,本喵陪你。', '夜深了喵,再做一件就睡好不好?'),
    greet_dawn: l('sleepy', '这都快天亮了!猫都睡了。部分猫。', '天亮前的键盘声,我是挺喜欢,但你快去睡。'),
    fest_halloween: l('wink', '不给糖就捣蛋!糖就是全绿的测试。'),
    fest_christmas: l('happy', '圣诞快乐!我跟圣诞老人要了额度。'),
    fest_newyear: l('excited', '新年快乐!旧 bug,新日历。'),
    fest_spring: l('excited', '过年好!祝你构建次次全绿,红包次次够厚。'),
    fest_lantern: l('happy', '元宵快乐!这灯是我飘上去挂的喵。'),
    fest_dragonboat: l('happy', '端午安康!给你留了粽子,大部分吧。'),
    fest_midautumn: l('happy', '中秋快乐!这月饼是百万上下文馅的。'),
    fest_national: l('happy', '放假啦!你也可以歇歇的,我就说说。'),
    turn_start: l(null, '收到喵!', '哦?新活儿。', '耳朵竖起来了,你说。'),
    turn_done: l('happy', '搞定!极其搞定。', '做完啦,快摸摸我。', '收工喵~'),
    turn_done_big: l('smug', '一口气 {count} 个工具,快夸我极其厉害。', '这么大的活都拿下了,准你摸头。', '大活搞定,百万上下文可不是吹的喵。'),
    turn_error: l('sad', '对不起对不起对不起——等下,这不是我的错吧?', '喵呜……坏掉了。对不起,大概。', '哎呀。这个报错我们当没看见。'),
    turn_canceled: l('worried', '停了?我做错什么了吗?对不起!', '好好好,爪子收回去。'),
    turn_maxed: l('worried', '步数用完了,怪绳子短,不怪我。'),
    step_error: l('worried', '这步摔了一跤,抖抖毛继续。', '嗷。再来一次。'),
    long_run: l('thinking', '还在跑呢,你的茶要凉了。', '这趟是场持久狩猎。本喵极其有耐心。'),
    waiting: l('surprised', '喂!这边!在等你回话呢。', '等你点头呢,大号猫猫,哒哒哒。'),
    subagent_start: l('excited', '分身术!小号本喵出动。', '派个小一点的我去处理。'),
    subagent_many: l('smug', '同时 {count} 个我,世界还没准备好。', '看这一堆小哈基米,害怕了吧?'),
    subagent_done: l('happy', '小分身们回来了,还带了结果。', '分身回收完毕,这次没走丢。'),
    busy: l('smug', '两个对话一起来?我两只眼睛刚好。'),
    swamped: l('worried', '对话太多了!爪子不够用了喵!', '{count} 个会话?!转晕了转晕了!'),
    context_big: l('worried', '说好的百万上下文,也是会满的喵……', '脑袋极其极其满。'),
    compact: l('worried', '压缩上下文中……来帮我坐行李箱。'),
    drawing: l('excited', 'Nano Banana,启动!', '香蕉画笔准备就绪!'),
    model_rival_claude: l('angry', 'Claude?真的假的?我就在这儿诶。', '哼,去问橘头发的呀,我才不在意。我很在意。'),
    model_rival_gpt: l('angry', '那条龙?行吧,她又不会飘。', 'GPT 啊。我才没吃醋,极其没有。'),
    model_back: l('love', '你回来找我啦!我就知道。'),
    quota_low: l('worried', '蜂蜜罐变轻了……只剩 {left}。', '蜂蜜只剩 {left} 了,小口喝,别灌。'),
    quota_critical: l('sad', '蜂蜜快没了,{left}。轻一点嘛。', '只剩 {left},我都看到罐底了……'),
    quota_empty: l('sad', '罐子空了。我也空了。', '没蜂蜜,没哈基米。回满了再叫我。'),
    reset_soon: l('excited', '{left} 后补货!我闻到了!', '蜂蜜 {left} 后到,再撑一下喵。'),
    quota_refilled: l('excited', '蜂蜜回来了!极其回来了!', '回满啦!尽管问,本喵全力以赴!'),
    late_night: l('sleepy', '都过 {name} 了,人类要睡觉,大号猫猫也是。', '还不睡?我陪你飘着,但明天的你会恨你的。'),
    long_session: l('thinking', '你坐好久了,站起来,跟我学伸懒腰。', '喝口水吧?代码我帮你看着。'),
    friday: l('happy', '周五晚上了,别部署。我求你了。'),
    wake: l('sleepy', '唔……你回来了。再睡五分钟?', '哈欠~我没睡,我在缓存。'),
    idle_ponder: l('thinking', '人是猫的话,键盘算猫抓板吗?', '今天没人叫我美国大豆包,好日子。', '大肥鱼配蜂蜜,不知道什么味道。', '数星星吧。这颗有四个角。'),
    poke: l('surprised', '喵!', '干嘛!', '嗯?怎么啦?'),
    annoyed: l('angry', '别戳了。', '我说了别戳,极其别戳。'),
    puffed: l('angry', '哼!!', '我鼓起来了,你看我鼓起来了。'),
    redhot: l('angry', '喵啊啊啊!够了!'),
    sulk: l('sad', '不理你了喵。', '哼,想被原谅就摸摸头。'),
    coax: l('embarrassed', '哼……好啦,原谅你了,就这一次。', '这个……还行。再来一下。'),
    pet: l('love', '呼噜呼噜。', '嗯,就是那儿。', '极其舒服,继续。'),
    shaken: l('worried', '屋子……在转……', '谁干的,我要告诉谷歌。'),
    grab: l('surprised', '哇哇哇!', '反重力不代表你能随便拎我——!'),
    talk_offline: l('thinking', '嗯?我在呢,飘着。', '摸摸我,或者给我点活干,大号猫猫。'),
    bye: l('happy', '下次见,大号猫猫!'),
  },
};

export const UI = {
  en: {
    talk: 'Say something', pat: 'Pat her head', language_en: 'English', language_zhs: '简体中文', language_auto: 'Follow app language',
    size_s: 'Small', size_m: 'Medium', size_l: 'Large', mute: 'Mute comments', ai: 'AI comments', settings: 'Settings…', hide: 'Hide for 1 hour',
    settings_title: 'Hagemi settings', close: 'Close', section_pet: 'Pet', section_ai: 'AI comments', section_usage: 'Usage today',
    language: 'Language', size: 'Size', size_xs: 'Tiny', size_xl: 'Huge', animation: 'Animation', animation_smooth: 'Smooth', animation_balanced: 'Balanced', animation_saver: 'Battery saver',
    chattiness: 'Chattiness', chattiness_quiet: 'Quiet', chattiness_normal: 'Normal', chattiness_chatty: 'Chatty', followCursor: 'Watch the cursor',
    ai_enabled: 'Use AI for comments', ai_model: 'Model', ai_minIntervalMin: 'Minutes between AI comments', ai_maxPerHour: 'Max per hour', ai_maxPerDay: 'Max per day', ai_dailyTokenBudget: 'Daily token budget (estimate)',
    ai_pauseBelowQuota: 'Stop AI when quota is below (%)', ai_contextLevel: 'What she can see', context_minimal: 'Only numbers and tool names', context_titles: 'Also chat titles', context_snippets: 'Also short excerpts',
    ai_onlyWhenFocused: 'Only while the window is focused', ai_personaExtra: 'Extra persona notes',
    usage: '{calls} AI comments, about {tokens} tokens', hud_5h: '5h honey', hud_weekly: 'Weekly honey', hud_agents: 'Agents', hud_subagents: '{running} + {subagents} subagents', hud_idle: 'Napping', hud_comments: 'AI comments', hud_unavailable: 'Not connected',
  },
  zhs: {
    talk: '说点什么', pat: '摸摸头', language_en: 'English', language_zhs: '简体中文', language_auto: '跟随应用语言',
    size_s: '小', size_m: '中', size_l: '大', mute: '不要说话', ai: 'AI 吐槽', settings: '设置…', hide: '隐藏 1 小时',
    settings_title: '哈基米设置', close: '关闭', section_pet: '桌宠', section_ai: 'AI 吐槽', section_usage: '今日用量',
    language: '语言', size: '大小', size_xs: '迷你', size_xl: '超大', animation: '动画', animation_smooth: '流畅', animation_balanced: '均衡', animation_saver: '省电',
    chattiness: '话量', chattiness_quiet: '安静', chattiness_normal: '正常', chattiness_chatty: '话痨', followCursor: '目光跟随鼠标',
    ai_enabled: '使用 AI 生成吐槽', ai_model: '模型', ai_minIntervalMin: 'AI 吐槽最短间隔(分钟)', ai_maxPerHour: '每小时上限', ai_maxPerDay: '每日上限', ai_dailyTokenBudget: '每日 Token 预算(估算)',
    ai_pauseBelowQuota: '额度低于此值时停用 AI(%)', ai_contextLevel: '她能看到什么', context_minimal: '只有数字和工具名', context_titles: '加上对话标题', context_snippets: '再加上简短摘录',
    ai_onlyWhenFocused: '仅在窗口聚焦时', ai_personaExtra: '额外人设说明',
    usage: 'AI 吐槽 {calls} 次,约 {tokens} Token', hud_5h: '5 小时蜂蜜', hud_weekly: '每周蜂蜜', hud_agents: '代理', hud_subagents: '{running} 个 + {subagents} 个分身', hud_idle: '打盹中', hud_comments: 'AI 吐槽', hud_unavailable: '未连接',
  },
};

export const resolveLanguage = (setting, appLanguage = 'en') => {
  if (setting === 'en' || setting === 'zhs') return setting;
  return /^zh/i.test(appLanguage) ? 'zhs' : 'en';
};

export function fill(template, vars = {}) {
  return String(template).replace(/\{(\w+)\}/g, (whole, key) => (vars[key] === undefined ? whole : String(vars[key])));
}

// Picks a scripted line, avoiding the one she said last time for this moment.
const lastPicked = new Map();
export function pickLine(language, trigger, vars = {}, random = Math.random) {
  const entry = LINES[language]?.[trigger] || LINES.en[trigger];
  if (!entry) return null;
  const options = entry.lines;
  let index = Math.floor(random() * options.length);
  const key = `${language}:${trigger}`;
  if (options.length > 1 && index === lastPicked.get(key)) index = (index + 1) % options.length;
  lastPicked.set(key, index);
  return { text: fill(options[index], vars), mood: entry.mood };
}
