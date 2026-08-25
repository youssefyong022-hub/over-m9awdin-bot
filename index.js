const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Apostado Manager & Management Bot is alive and running 24/7!');
});

app.listen(port, () => {
    console.log(`Web server is listening on port ${port}`);
});

const { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    EmbedBuilder, 
    PermissionFlagsBits, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    UserSelectMenuBuilder, 
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    AttachmentBuilder,
    ChannelType
} = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const { createCanvas, loadImage } = require('@napi-rs/canvas');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// الاتصال بقاعدة البيانات وإعداد الجداول
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) console.error('Error opening database', err.message);
    else console.log('Connected to SQLite database successfully.');
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        userId TEXT,
        guildId TEXT,
        points INTEGER DEFAULT 1000,
        wins INTEGER DEFAULT 0,
        losses INTEGER DEFAULT 0,
        mvps INTEGER DEFAULT 0,
        matches INTEGER DEFAULT 0,
        organize INTEGER DEFAULT 0,
        xp INTEGER DEFAULT 0,
        level INTEGER DEFAULT 1,
        messages INTEGER DEFAULT 0,
        voiceTime INTEGER DEFAULT 0,
        PRIMARY KEY (userId, guildId)
    )`);

    const requiredColumns = [
        { name: 'points', type: 'INTEGER DEFAULT 1000' },
        { name: 'wins', type: 'INTEGER DEFAULT 0' },
        { name: 'losses', type: 'INTEGER DEFAULT 0' },
        { name: 'mvps', type: 'INTEGER DEFAULT 0' },
        { name: 'matches', type: 'INTEGER DEFAULT 0' },
        { name: 'organize', type: 'INTEGER DEFAULT 0' }
    ];

    requiredColumns.forEach(col => {
        db.run(`ALTER TABLE users ADD COLUMN ${col.name} ${col.type}`, (err) => {
            // تجاهل إن كان موجوداً
        });
    });
});

// دوال مساعدة لقاعدة البيانات
function getUserStats(userId, guildId) {
    return new Promise((resolve, reject) => {
        db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [userId, guildId], (err, row) => {
            if (err) return reject(err);
            if (!row) {
                db.run(`INSERT INTO users (userId, guildId, points, wins, losses, mvps, matches, organize, xp, level, messages, voiceTime) VALUES (?, ?, 1000, 0, 0, 0, 0, 0, 0, 1, 0, 0)`, [userId, guildId], function(insertErr) {
                    if (insertErr) return reject(insertErr);
                    resolve({ userId, guildId, points: 1000, wins: 0, losses: 0, mvps: 0, matches: 0, organize: 0, xp: 0, level: 1, messages: 0, voiceTime: 0, rank: 1 });
                });
            } else {
                db.get(`SELECT COUNT(*) as rankHigher FROM users WHERE guildId = ? AND points > ?`, [guildId, row.points || 0], (rErr, rRow) => {
                    const rank = rRow ? rRow.rankHigher + 1 : 1;
                    resolve({ ...row, rank });
                });
            }
        });
    });
}

function updateMatchStats(guildId, winners, losers, mvpWinnerId, mvpLoserId, hostId) {
    return new Promise((resolve) => {
        winners.forEach(uid => {
            const isMvp = uid === mvpWinnerId;
            const pts = isMvp ? 45 : 25;
            const mvpInc = isMvp ? 1 : 0;
            db.run(`UPDATE users SET points = points + ?, wins = wins + 1, matches = matches + 1, mvps = mvps + ? WHERE userId = ? AND guildId = ?`, [pts, mvpInc, uid, guildId]);
        });

        losers.forEach(uid => {
            const isMvp = uid === mvpLoserId;
            const pts = isMvp ? 10 : 0;
            const mvpInc = isMvp ? 1 : 0;
            db.run(`UPDATE users SET points = points + ?, losses = losses + 1, matches = matches + 1, mvps = mvps + ? WHERE userId = ? AND guildId = ?`, [pts, mvpInc, uid, guildId]);
        });

        if (hostId) {
            db.run(`UPDATE users SET organize = organize + 1, points = points + 5 WHERE userId = ? AND guildId = ?`, [hostId, guildId]);
        }
        resolve();
    });
}

// دالة توليد بطاقة الكانفاس للبروفايل !p
async function generateProfileCard(user, member, stats) {
    const width = 740;
    const height = 330;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // خلفية الحاوية الكبرى
    ctx.fillStyle = '#0f1013';
    roundRect(ctx, 0, 0, width, height, 22);
    ctx.fill();

    // البطاقة الداخلية
    ctx.fillStyle = '#17181c';
    roundRect(ctx, 12, 12, width - 24, height - 24, 18);
    ctx.fill();

    // إطار خفيف
    ctx.strokeStyle = '#23252b';
    ctx.lineWidth = 1.5;
    roundRect(ctx, 12, 12, width - 24, height - 24, 18);
    ctx.stroke();

    // رسم صورة العضو الدائرية
    const avatarX = 68;
    const avatarY = 68;
    const avatarRadius = 38;

    try {
        const avatarURL = user.displayAvatarURL({ extension: 'png', size: 256 });
        const avatarImage = await loadImage(avatarURL);

        ctx.save();
        ctx.beginPath();
        ctx.arc(avatarX, avatarY, avatarRadius, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(avatarImage, avatarX - avatarRadius, avatarY - avatarRadius, avatarRadius * 2, avatarRadius * 2);
        ctx.restore();
    } catch (e) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(avatarX, avatarY, avatarRadius, 0, Math.PI * 2);
        ctx.fillStyle = '#34373c';
        ctx.fill();
        ctx.restore();
    }

    // إطار الأفاتار
    ctx.beginPath();
    ctx.arc(avatarX, avatarY, avatarRadius + 2, 0, Math.PI * 2);
    ctx.strokeStyle = '#2e3038';
    ctx.lineWidth = 3;
    ctx.stroke();

    // اسم المستخدم
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'left';
    const displayName = member ? member.displayName : user.username;
    ctx.fillText(displayName.length > 20 ? displayName.slice(0, 18) + '...' : displayName, 125, 62);

    // الرتبة / اللقب
    ctx.fillStyle = '#8e9297';
    ctx.font = '14px sans-serif';
    ctx.fillText('Top Player!', 125, 86);

    // خط فاصل أنيق
    ctx.strokeStyle = '#24262c';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(35, 125);
    ctx.lineTo(width - 35, 125);
    ctx.stroke();

    // حساب نسبة الفوز
    const totalMatches = stats.matches || (stats.wins + stats.losses);
    const winrate = totalMatches > 0 ? Math.round((stats.wins / totalMatches) * 100) : 0;

    // شبكة الإحصائيات (2 صفوف × 4 أعمدة)
    const statsGrid = [
        [
            { label: 'POINTS', value: `${stats.points || 0}` },
            { label: 'WINS', value: `${stats.wins || 0}` },
            { label: 'LOSSES', value: `${stats.losses || 0}` },
            { label: 'MVPS', value: `${stats.mvps || 0}` }
        ],
        [
            { label: 'MATCHES', value: `${totalMatches || 0}` },
            { label: 'ORGANIZE', value: `${stats.organize || 0}` },
            { label: 'WINRATE', value: `${winrate}%` },
            { label: 'RANK', value: `#${stats.rank || 1}` }
        ]
    ];

    const colWidth = (width - 70) / 4;
    const startX = 35;

    // رسم الصف الأول
    statsGrid[0].forEach((item, i) => {
        const x = startX + i * colWidth + colWidth / 2;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#72767d';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(item.label, x, 160);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 22px sans-serif';
        ctx.fillText(item.value, x, 195);
    });

    // رسم الصف الثاني
    statsGrid[1].forEach((item, i) => {
        const x = startX + i * colWidth + colWidth / 2;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#72767d';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(item.label, x, 240);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 22px sans-serif';
        ctx.fillText(item.value, x, 275);
    });

    return canvas.toBuffer('image/png');
}

function roundRect(ctx, x, y, w, h, r) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// تخزين المباريات الحالية النشطة
const activeMatches = new Map();
const activeCheckSessions = new Map();
let checkStats = { pending: 1, cheaters: 7, clean: 5 };

client.once('clientReady', async () => {
    console.log(`Logged in as ${client.user.tag} (Apostado Manager Active)`);

    const commands = [
        new SlashCommandBuilder()
            .setName('profile')
            .setDescription('عرض بروفايل العضو الإحصائي')
            .addUserOption(option => option.setName('user').setDescription('اختر عضواً').setRequired(false)),
        new SlashCommandBuilder()
            .setName('rank')
            .setDescription('عرض مستوى ورتبة العضو')
            .addUserOption(option => option.setName('user').setDescription('اختر عضواً').setRequired(false)),
        new SlashCommandBuilder()
            .setName('leaderboard')
            .setDescription('عرض لوحة المتصدرين بالنقاط'),
        new SlashCommandBuilder()
            .setName('rules')
            .setDescription('عرض قوانين السيرفر الرسمية'),
        new SlashCommandBuilder()
            .setName('giverole')
            .setDescription('إعطاء رتبة لعضو معين')
            .addUserOption(option => option.setName('member').setDescription('العضو المستهدف').setRequired(true))
            .addRoleOption(option => option.setName('role').setDescription('الرتبة المراد إعطاؤها').setRequired(true)),
        new SlashCommandBuilder()
            .setName('removerole')
            .setDescription('سحب رتبة من عضو معين')
            .addUserOption(option => option.setName('member').setDescription('العضو المستهدف').setRequired(true))
            .addRoleOption(option => option.setName('role').setDescription('الرتبة المراد سحبها').setRequired(true)),
        new SlashCommandBuilder()
            .setName('ticket')
            .setDescription('إرسال لوحة التذاكر والدعم الفني')
            .addChannelOption(option =>
                option.setName('channel')
                    .setDescription('القناة التي ستُرسل فيها لوحة التذاكر')
                    .setRequired(true)
            ),
        new SlashCommandBuilder()
            .setName('checker')
            .setDescription('إرسال لوحة فحص اللاعبين V2 المطابقة تماماً')
            .addChannelOption(option =>
                option.setName('channel')
                    .setDescription('القناة التي ستُرسل فيها لوحة الفحص')
                    .setRequired(true)
            ),
        new SlashCommandBuilder()
            .setName('live')
            .setDescription('إرسال إشعار البث المباشر لسيرفر OVER M9WDN')
            .addStringOption(option =>
                option.setName('link')
                    .setDescription('رابط البث المباشر')
                    .setRequired(true)
            )
            .addStringOption(option =>
                option.setName('title')
                    .setDescription('عنوان البث (اختياري)')
                    .setRequired(false)
            )
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Slash commands registered successfully.');
    } catch (error) {
        console.error('Error registering slash commands:', error);
    }
});

// معالجة الرسائل العادية
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    const userId = message.author.id;
    const guildId = message.guild.id;

    // تتبع الـ XP
    db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [userId, guildId], (err, row) => {
        if (!row) {
            db.run(`INSERT INTO users (userId, guildId, xp, level, messages) VALUES (?, ?, 15, 1, 1)`, [userId, guildId]);
        } else {
            const newXp = row.xp + 15;
            const newMessages = row.messages + 1;
            let newLevel = row.level;
            if (newXp >= row.level * 100) newLevel += 1;
            db.run(`UPDATE users SET xp = ?, level = ?, messages = ? WHERE userId = ? AND guildId = ?`, [newXp, newLevel, newMessages, userId, guildId]);
        }
    });

    const content = message.content.trim();

    // أمر البروفايل !p أو !profile
    if (content.toLowerCase() === '!p' || content.toLowerCase() === '!profile') {
        try {
            const stats = await getUserStats(userId, guildId);
            const buffer = await generateProfileCard(message.author, message.member, stats);
            const attachment = new AttachmentBuilder(buffer, { name: 'profile.png' });
            return message.reply({ files: [attachment] });
        } catch (err) {
            console.error(err);
            return message.reply('❌ حدث خطأ أثناء إنشاء بطاقة البروفايل.');
        }
    }

    // أمر لوحة المتصدرين !top
    if (content.toLowerCase() === '!top' || content.toLowerCase() === '!leaderboard') {
        db.all(`SELECT * FROM users WHERE guildId = ? ORDER BY points DESC LIMIT 10`, [guildId], (err, rows) => {
            if (err || !rows || rows.length === 0) {
                return message.reply('📊 لا توجد إحصائيات كافية بعد.');
            }
            const desc = rows.map((r, i) => `**#${i + 1}** <@${r.userId}> — 🏆 **${r.points}** pts | ⚔️ **${r.wins}** W / **${r.losses}** L`).join('\n');
            const topEmbed = new EmbedBuilder()
                .setColor('#2b2d31')
                .setTitle('🏆 Apostado Leaderboard')
                .setDescription(desc)
                .setFooter({ text: 'Apostado Manager', iconURL: message.guild.iconURL() })
                .setTimestamp();
            return message.reply({ embeds: [topEmbed] });
        });
        return;
    }

    // أمر إنشاء المباريات !play
    if (content.toLowerCase().startsWith('!play') || content.toLowerCase().startsWith('! play')) {
        const cleanContent = content.replace(/\s+/g, ' ').trim();
        const parts = cleanContent.split(' ');
        
        let modeArg = parts[1] ? parts[1].toLowerCase() : '';
        if (cleanContent.toLowerCase().startsWith('! play')) {
            modeArg = parts[2] ? parts[2].toLowerCase() : '';
        }

        const validModes = {
            '1v1': 1,
            '2v2': 2,
            '3v3': 3,
            '4v4': 4
        };

        if (!modeArg || !validModes[modeArg]) {
            const invalidEmbed = new EmbedBuilder()
                .setColor('#2b2d31')
                .setTitle('ℹ️ Invalid Mode')
                .setDescription('Please specify a valid mode: `!play 1v1`, `!play 2v2`, `!play 3v3`, or `!play 4v4`')
                .setFooter({ text: new Date().toLocaleString() });

            return message.reply({ embeds: [invalidEmbed] });
        }

        // التحقق من أن المستضيف متواجد في إحدى غرف الانتظار
        const hostVoice = message.member?.voice?.channel;
        if (!hostVoice || !hostVoice.name.toLowerCase().includes('waiting')) {
            return message.reply('❌ **يجب أن تكون متواجداً في إحدى غرف الانتظار (waiting 1 / waiting 2 / waiting 3...) أولاً** لإنشاء المباراة!');
        }

        const teamSize = validModes[modeArg];
        const matchId = Math.floor(10000 + Math.random() * 90000).toString();

        const match = {
            id: matchId,
            guildId: message.guild.id,
            channelId: message.channel.id,
            hostId: message.author.id,
            mode: modeArg.toUpperCase(),
            teamSize: teamSize,
            roomId: null,
            password: null,
            privateKey: null,
            team1: [],
            team2: [],
            originalVoiceChannels: new Map(), // userId -> original waiting channel ID
            state: 'WAITING_INFO',
            promptMessageId: null,
            lobbyMessageId: null,
            threadId: null,
            team1VoiceId: null,
            team2VoiceId: null,
            infoTimeout: null,
            lobbyTimeout: null,
            winnerVotes: new Map(), // userId -> { voterTeam, winningTeam, mvpUid }
            loserVotes: new Map(),  // userId -> mvpLoserUid
            votingCompleted: false
        };

        activeMatches.set(matchId, match);

        const createEmbed = new EmbedBuilder()
            .setColor('#2b2d31')
            .setTitle(`✔ Create ${match.mode} Match`)
            .setDescription(`**Host:** <@${message.author.id}>\n\nClick the button below to enter the room information.\nThis will create the match and allow players to join.`)
            .setFooter({ text: new Date().toLocaleString() });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`enter_room_info_${matchId}`)
                .setLabel('Enter Room Info')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('👾')
        );

        const promptMsg = await message.reply({ embeds: [createEmbed], components: [row] });
        match.promptMessageId = promptMsg.id;

        // مهلة 30 ثانية لإدخال معلومات الروم
        match.infoTimeout = setTimeout(async () => {
            const currentMatch = activeMatches.get(matchId);
            if (currentMatch && currentMatch.state === 'WAITING_INFO') {
                activeMatches.delete(matchId);
                const timeoutEmbed = new EmbedBuilder()
                    .setColor('#2b2d31')
                    .setDescription(`You didn't enter room information within 30 seconds\n\nMode: ${match.mode}\nUse \`!play ${modeArg}\` to try again.`)
                    .setFooter({ text: new Date().toLocaleString() });

                await promptMsg.edit({ embeds: [timeoutEmbed], components: [] }).catch(() => {});
            }
        }, 30000);
    }
});

// معالجة التفاعلات
client.on('interactionCreate', async interaction => {
    try {
        // --- 1. أوامر Slash Commands ---
        if (interaction.isChatInputCommand()) {
            const { commandName } = interaction;

            if (commandName === 'profile') {
                await interaction.deferReply();
                const targetUser = interaction.options.getUser('user') || interaction.user;
                const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
                const stats = await getUserStats(targetUser.id, interaction.guild.id);
                const buffer = await generateProfileCard(targetUser, member, stats);
                const attachment = new AttachmentBuilder(buffer, { name: 'profile.png' });
                return interaction.editReply({ files: [attachment] });
            }

            if (commandName === 'rank') {
                const targetUser = interaction.options.getUser('user') || interaction.user;
                const stats = await getUserStats(targetUser.id, interaction.guild.id);
                const embed = new EmbedBuilder()
                    .setColor('#2b2d31')
                    .setTitle(`🏆 Rank Stats — ${targetUser.username}`)
                    .setDescription(`إحصائيات الرتبة والنقاط الرسمية`)
                    .setThumbnail(targetUser.displayAvatarURL({ size: 512 }))
                    .addFields(
                        { name: '⭐ Level', value: `${stats.level}`, inline: true },
                        { name: '✨ XP', value: `${stats.xp}`, inline: true },
                        { name: '🏆 Points', value: `${stats.points}`, inline: true },
                        { name: '📊 Server Rank', value: `#${stats.rank}`, inline: true },
                        { name: '⚔️ Wins / Losses', value: `${stats.wins}W / ${stats.losses}L`, inline: true },
                        { name: '👾 MVPs', value: `${stats.mvps}`, inline: true }
                    )
                    .setFooter({ text: `Apostado Manager`, iconURL: interaction.guild.iconURL() })
                    .setTimestamp();
                return interaction.reply({ embeds: [embed] });
            }

            if (commandName === 'leaderboard') {
                db.all(`SELECT * FROM users WHERE guildId = ? ORDER BY points DESC LIMIT 10`, [interaction.guild.id], (err, rows) => {
                    if (err || !rows || rows.length === 0) {
                        return interaction.reply({ content: '📊 لا توجد إحصائيات كافية بعد.', ephemeral: true });
                    }
                    const desc = rows.map((r, i) => `**#${i + 1}** <@${r.userId}> — 🏆 **${r.points}** pts | ⚔️ **${r.wins}** W / **${r.losses}** L`).join('\n');
                    const topEmbed = new EmbedBuilder()
                        .setColor('#2b2d31')
                        .setTitle('🏆 Apostado Leaderboard')
                        .setDescription(desc)
                        .setFooter({ text: 'Apostado Manager', iconURL: interaction.guild.iconURL() })
                        .setTimestamp();
                    return interaction.reply({ embeds: [topEmbed] });
                });
            }

            if (commandName === 'rules') {
                const rulesText = `
╭━━━ 🛡️ **[ APOSTADO ACADEMY - SERVER RULES ]** 🛡️ ━━━╮
✨ **أهلاً بك يا بطل في مجتمعنا الرسمي!** لضمان بيئة لعب نزيهة واحترافية:
> 🔹 **الاحترام المتبادل:** يمنع الشتم والسب منعاً باتاً داخل الرومات أو الشات.
> 🔹 **ممنوع الغش والهاكات:** أي لاعب يُثبت استخدامه لأي برنامج غير قانوني يُطرد فوراً.
> 🔹 **الالتزام بالرومات الصوتية:** يجب التواجد في غرف الانتظار (waiting) قبل الدخول للماتش.
📌 **Apostado Manager • Fair Play System**
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━╯`;
                return interaction.reply({ content: rulesText });
            }

            if (commandName === 'giverole') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
                    return interaction.reply({ content: '❌ ليس لديك صلاحية لإدارة الرتب!', ephemeral: true });
                }
                const targetMember = interaction.options.getMember('member');
                const targetRole = interaction.options.getRole('role');
                if (!targetMember) return interaction.reply({ content: '❌ لم يتم العثور على هذا العضو!', ephemeral: true });
                if (interaction.guild.members.me.roles.highest.position <= targetRole.position) {
                    return interaction.reply({ content: '❌ رتبة البوت أدنى أو مساوية لهذه الرتبة!', ephemeral: true });
                }
                await targetMember.roles.add(targetRole);
                const embed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle('⚡ ROLE ASSIGNED SUCCESSFULLY ⚡')
                    .setDescription('تم إعطاء الرتبة بنجاح!')
                    .addFields(
                        { name: '👤 Target Member', value: `${targetMember} (\`${targetMember.user.username}\`)`, inline: false },
                        { name: '🛡️ Granted Role', value: `${targetRole}`, inline: true },
                        { name: '👑 Managed By', value: `${interaction.user}`, inline: true }
                    )
                    .setTimestamp();
                return interaction.reply({ embeds: [embed] });
            }

            if (commandName === 'removerole') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
                    return interaction.reply({ content: '❌ ليس لديك صلاحية لإدارة الرتب!', ephemeral: true });
                }
                const targetMember = interaction.options.getMember('member');
                const targetRole = interaction.options.getRole('role');
                if (!targetMember) return interaction.reply({ content: '❌ لم يتم العثور على هذا العضو!', ephemeral: true });
                if (interaction.guild.members.me.roles.highest.position <= targetRole.position) {
                    return interaction.reply({ content: '❌ رتبة البوت أدنى أو مساوية لهذه الرتبة!', ephemeral: true });
                }
                await targetMember.roles.remove(targetRole);
                const embed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('⚠️ ROLE REMOVED SUCCESSFULLY ⚠️')
                    .setDescription('تم سحب الرتبة بنجاح!')
                    .addFields(
                        { name: '👤 Target Member', value: `${targetMember} (\`${targetMember.user.username}\`)`, inline: false },
                        { name: '🛡️ Removed Role', value: `${targetRole}`, inline: true },
                        { name: '👑 Managed By', value: `${interaction.user}`, inline: true }
                    )
                    .setTimestamp();
                return interaction.reply({ embeds: [embed] });
            }

            if (commandName === 'ticket') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                    return interaction.reply({ content: '❌ ليس لديك صلاحية لاستخدام هذا الأمر!', ephemeral: true });
                }
                const targetChannel = interaction.options.getChannel('channel');
                const ticketEmbed = new EmbedBuilder()
                    .setColor('#2b2d31')
                    .setTitle('📁 Tickets')
                    .setDescription('Select a category to open a ticket.');
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('create_ticket_help').setLabel('Help').setStyle(ButtonStyle.Secondary).setEmoji('🛡️'),
                    new ButtonBuilder().setCustomId('create_ticket_abuse').setLabel('Server Abuse').setStyle(ButtonStyle.Danger).setEmoji('⚔️')
                );
                await targetChannel.send({ embeds: [ticketEmbed], components: [row] });
                return interaction.reply({ content: `✅ تم إرسال لوحة التذاكر بنجاح إلى ${targetChannel}`, ephemeral: true });
            }

            if (commandName === 'checker') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                    return interaction.reply({ content: '❌ ليس لديك صلاحية لاستخدام هذا الأمر!', ephemeral: true });
                }
                const targetChannel = interaction.options.getChannel('channel');
                const v2CheckerEmbed = new EmbedBuilder()
                    .setColor('#2f3136')
                    .setTitle('Player Check System')
                    .setDescription('Report suspicious players for verification\n\n🚨 **How it works:**\n• Click **Check a user** → @tag a **server member**\n• Choose if they play on **Phone** or **PC**\n• Pay **50 points** to request a check\n• If the player is a **cheater** → Your **50 points** are recovered and you get **+20 points** 🤌\n• If the player is **clean** → You lose **30 points**\n\nStats:\n> Pending: `' + checkStats.pending + '` | Cheaters Found: `' + checkStats.cheaters + '` | Clean: `' + checkStats.clean + '`')
                    .setFooter({ text: 'Apostado Anti-Cheat Division', iconURL: client.user.displayAvatarURL() })
                    .setTimestamp();
                const v2CheckerRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('open_checker_interactive').setLabel('Check a user').setStyle(ButtonStyle.Secondary).setEmoji('🔍'),
                    new ButtonBuilder().setCustomId('view_my_reports').setLabel('See my reports').setStyle(ButtonStyle.Secondary).setEmoji('📋')
                );
                await targetChannel.send({ embeds: [v2CheckerEmbed], components: [v2CheckerRow] });
                return interaction.reply({ content: `✅ تم إرسال لوحة الفحص بنجاح إلى ${targetChannel}`, ephemeral: true });
            }

            if (commandName === 'live') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                    return interaction.reply({ content: '❌ هذا الأمر مخصص للإدارة فقط!', ephemeral: true });
                }
                const streamLink = interaction.options.getString('link');
                const streamTitle = interaction.options.getString('title') || 'البث المباشر بدأ الان! انضم إلينا';
                const liveEmbed = new EmbedBuilder()
                    .setColor(0xff0055)
                    .setTitle(`🔴 ${streamTitle}`)
                    .setDescription(`**يا شباب، تم فتح البث المباشر الآن!**\n\n🔗 **رابط البث:** [اضغط هنا للدخول](${streamLink})`)
                    .setFooter({ text: 'Apostado Live Notifications', iconURL: client.user.displayAvatarURL() })
                    .setTimestamp();
                await interaction.reply({ content: '✅ جاري إرسال إشعار البث...', ephemeral: true });
                await interaction.channel.send({ content: `🚀 **هجوم يا أبطال، البث فتح!**`, embeds: [liveEmbed] });
            }
        }

        // --- 2. أزرار الماتش والمودال ---
        if (interaction.isButton()) {
            const { customId } = interaction;

            // فتح نموذج إدخال معلومات الروم
            if (customId.startsWith('enter_room_info_')) {
                const matchId = customId.split('_')[3];
                const match = activeMatches.get(matchId);

                if (!match) {
                    return interaction.reply({ content: '❌ هذه المباراة لم تعد متوفرة.', ephemeral: true });
                }

                if (interaction.user.id !== match.hostId) {
                    return interaction.reply({ content: '❌ فقط منشئ المباراة (Host) يمكنه إدخال معلومات الروم!', ephemeral: true });
                }

                const modal = new ModalBuilder()
                    .setCustomId(`modal_room_info_${matchId}`)
                    .setTitle('👾 Enter Room Information');

                const roomIdInput = new TextInputBuilder()
                    .setCustomId('room_id')
                    .setLabel('Room ID (Numbers Only) *')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Enter the game room ID (numbers only)')
                    .setRequired(true);

                const passwordInput = new TextInputBuilder()
                    .setCustomId('room_password')
                    .setLabel('Password (Optional)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Enter room password if any')
                    .setRequired(false);

                const keyInput = new TextInputBuilder()
                    .setCustomId('private_key')
                    .setLabel('Private Match Key (Optional)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('If set, players must enter this key to join')
                    .setRequired(false);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(roomIdInput),
                    new ActionRowBuilder().addComponents(passwordInput),
                    new ActionRowBuilder().addComponents(keyInput)
                );

                return interaction.showModal(modal);
            }

            // الانضمام للفريق 1 أو الفريق 2
            if (customId.startsWith('join_team1_') || customId.startsWith('join_team2_')) {
                const isTeam1 = customId.startsWith('join_team1_');
                const matchId = customId.split('_')[2];
                const match = activeMatches.get(matchId);

                if (!match || match.state !== 'LOBBY') {
                    return interaction.reply({ content: '❌ هذه المباراة لم تعد متاحة للانضمام.', ephemeral: true });
                }

                // التحقق الدقيق: يجب أن يكون اللاعب داخل إحدى غرف الانتظار (waiting)
                const voiceChannel = interaction.member?.voice?.channel;
                if (!voiceChannel || !voiceChannel.name.toLowerCase().includes('waiting')) {
                    return interaction.reply({ 
                        content: '❌ **يجب أن تكون متواجداً في إحدى غرف الانتظار (waiting 1 / waiting 2 / waiting 3...) أولاً** حتى يتمكن البوت من نقلك تلقائياً عند اكتمال الفرق!', 
                        ephemeral: true 
                    });
                }

                // التحقق من المفتاح الخاص إن وجد
                if (match.privateKey && interaction.user.id !== match.hostId) {
                    const keyModal = new ModalBuilder()
                        .setCustomId(`modal_join_key_${matchId}_${isTeam1 ? '1' : '2'}`)
                        .setTitle('🔑 Private Match Key');

                    const keyInput = new TextInputBuilder()
                        .setCustomId('entered_key')
                        .setLabel('Enter Match Key')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('Enter the private key set by host')
                        .setRequired(true);

                    keyModal.addComponents(new ActionRowBuilder().addComponents(keyInput));
                    return interaction.showModal(keyModal);
                }

                return handleTeamJoin(interaction, match, isTeam1 ? 1 : 2);
            }

            // مغادرة الفريق
            if (customId.startsWith('leave_match_')) {
                const matchId = customId.split('_')[2];
                const match = activeMatches.get(matchId);

                if (!match || match.state !== 'LOBBY') {
                    return interaction.reply({ content: '❌ هذه المباراة لم تعد نشطة.', ephemeral: true });
                }

                const uid = interaction.user.id;
                match.team1 = match.team1.filter(id => id !== uid);
                match.team2 = match.team2.filter(id => id !== uid);

                await updateLobbyMessage(interaction.guild, match);
                return interaction.reply({ content: '✅ لقد غادرت التشكيلة بنجاح.', ephemeral: true });
            }

            // إلغاء المباراة من قبل الهوست
            if (customId.startsWith('cancel_match_')) {
                const matchId = customId.split('_')[2];
                const match = activeMatches.get(matchId);

                if (!match) {
                    return interaction.reply({ content: '❌ هذه المباراة غير موجودة.', ephemeral: true });
                }

                const isHost = interaction.user.id === match.hostId;
                const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);

                if (!isHost && !isAdmin) {
                    return interaction.reply({ content: '❌ فقط منشئ المباراة أو الإدارة يمكنهم إلغاء المباراة!', ephemeral: true });
                }

                if (match.lobbyTimeout) clearTimeout(match.lobbyTimeout);
                activeMatches.delete(matchId);

                const cancelEmbed = new EmbedBuilder()
                    .setColor(0xED4245)
                    .setTitle('✖ Match Cancelled')
                    .setDescription(`**${match.mode}** match created by <@${match.hostId}> was cancelled by the host.\n\nUse \`!play ${match.mode.toLowerCase()}\` to start a new match.`)
                    .setFooter({ text: new Date().toLocaleString() });

                if (interaction.message) {
                    await interaction.message.edit({ embeds: [cancelEmbed], components: [] }).catch(() => {});
                }
                return interaction.reply({ content: '✅ تم إلغاء المباراة بنجاح.', ephemeral: true });
            }

            // نسخ معلومات الروم
            if (customId.startsWith('copy_room_info_')) {
                const matchId = customId.split('_')[3];
                const match = activeMatches.get(matchId);
                if (!match) {
                    return interaction.reply({ content: '❌ معلومات الروم غير متوفرة حالياً.', ephemeral: true });
                }
                const passText = match.password ? match.password : 'No Password';
                return interaction.reply({ 
                    content: `📋 **معلومات الروم:**\n**Room ID:** \`${match.roomId}\`\n**Password:** \`${passText}\``, 
                    ephemeral: true 
                });
            }

            // أزرار التذاكر وفحص اللاعبين
            if (customId === 'create_ticket_help' || customId === 'create_ticket_abuse') {
                await interaction.deferReply({ ephemeral: true });
                const ticketType = customId === 'create_ticket_help' ? 'Help' : 'Server Abuse';
                const channelName = `ticket-${interaction.user.username.toLowerCase()}`;
                const existingChannel = interaction.guild.channels.cache.find(c => c.name === channelName);
                if (existingChannel) {
                    return interaction.editReply({ content: `❌ لديك تذكرة مفتوحة بالفعل هنا: ${existingChannel}` });
                }
                const ticketChannel = await interaction.guild.channels.create({
                    name: channelName,
                    type: 0,
                    permissionOverwrites: [
                        { id: interaction.guild.id, deny: ['ViewChannel'] },
                        { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
                        { id: client.user.id, allow: ['ViewChannel', 'SendMessages', 'ManageChannels', 'ReadMessageHistory'] }
                    ],
                });
                const welcomeEmbed = new EmbedBuilder()
                    .setColor(ticketType === 'Help' ? '#0099ff' : '#ff0000')
                    .setTitle(`📁 ${ticketType} Ticket`)
                    .setDescription(`مرحباً بك ${interaction.user}، سيقوم أحد أعضاء فريق الإدارة بمساعدتك قريباً.`);
                const ticketControlRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒')
                );
                await ticketChannel.send({ content: `${interaction.user} أهلاً بك!`, embeds: [welcomeEmbed], components: [ticketControlRow] });
                return interaction.editReply({ content: `✅ تم إنشاء تذكرتك بنجاح في القناة: ${ticketChannel}` });
            }

            if (customId === 'close_ticket') {
                if (!interaction.member.permissions.has('ManageChannels')) {
                    return interaction.reply({ content: '❌ فقط الإدارة يمكنها إغلاق التذكرة!', ephemeral: true });
                }
                await interaction.reply({ content: '🔒 جاري إغلاق وحذف التذكرة...' });
                setTimeout(async () => {
                    try { await interaction.channel.delete(); } catch (e) {}
                }, 4000);
            }

            if (customId === 'open_checker_interactive') {
                activeCheckSessions.set(interaction.user.id, { suspectId: null, platform: null });
                const panelEmbed = new EmbedBuilder()
                    .setColor('#2f3136')
                    .setTitle('New Player Check')
                    .setDescription('Search And Pick The Player, Choose Their Device, Then Send The Request To The Check Room.');
                const userSelect = new UserSelectMenuBuilder()
                    .setCustomId('select_suspect_user')
                    .setPlaceholder('Search & pick the player to check...')
                    .setMinValues(1)
                    .setMaxValues(1);
                const platformSelect = new StringSelectMenuBuilder()
                    .setCustomId('select_suspect_platform')
                    .setPlaceholder('Select device: PC or Phone')
                    .addOptions([
                        { label: 'PC', description: 'Plays on PC', value: 'PC', emoji: '💻' },
                        { label: 'Phone', description: 'Plays on Phone / Mobile', value: 'Phone', emoji: '📱' }
                    ]);
                const submitButton = new ButtonBuilder()
                    .setCustomId('submit_final_check')
                    .setLabel('Send Check')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('🚀');
                return interaction.reply({
                    embeds: [panelEmbed],
                    components: [
                        new ActionRowBuilder().addComponents(userSelect),
                        new ActionRowBuilder().addComponents(platformSelect),
                        new ActionRowBuilder().addComponents(submitButton)
                    ],
                    ephemeral: true
                });
            }

            if (customId === 'view_my_reports') {
                return interaction.reply({ content: `📋 **سجل تقاريرك:** ليس لديك أي بلاغات سابقة حتى الآن.`, ephemeral: true });
            }

            if (customId === 'submit_final_check') {
                const session = activeCheckSessions.get(interaction.user.id);
                if (!session || !session.suspectId || !session.platform) {
                    return interaction.reply({ content: '❌ يجب عليك اختيار اللاعب أولاً وتحديد المنصة (PC أو Phone)!', ephemeral: true });
                }
                const suspectMember = await interaction.guild.members.fetch(session.suspectId).catch(() => null);
                const suspectName = suspectMember ? suspectMember.displayName : 'Unknown User';
                checkStats.pending += 1;
                const adminChannel = interaction.guild.channels.cache.find(c => c.name === 'check-services' || c.name === 'check-place-user') || interaction.channel;
                const reportEmbed = new EmbedBuilder()
                    .setColor('#ffaa00')
                    .setTitle('🚨 Player Check Request 🚨')
                    .setDescription(`**Player:** ${suspectName}  ·  \`${session.suspectId}\`\n**Device:** ${session.platform}\n**Requested by:** ${interaction.user}`)
                    .setFooter({ text: 'Apostado Anti-Cheat Division', iconURL: client.user.displayAvatarURL() })
                    .setTimestamp();
                const adminActionRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('check_clean').setLabel('Clean').setStyle(ButtonStyle.Success).setEmoji('🟢'),
                    new ButtonBuilder().setCustomId('check_cheater').setLabel('Cheater').setStyle(ButtonStyle.Danger).setEmoji('🔴'),
                    new ButtonBuilder().setCustomId('check_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary).setEmoji('❌')
                );
                await adminChannel.send({ content: `📢 **تنبيه إداري جديد:** ${interaction.user} قام بالإبلاغ عن لاعب!`, embeds: [reportEmbed], components: [adminActionRow] });
                activeCheckSessions.delete(interaction.user.id);
                return interaction.update({ content: `🛡️ **تم إرسال بلاغ الفحص بنجاح إلى الإدارة!**`, embeds: [], components: [] });
            }

            if (['check_clean', 'check_cheater', 'check_cancel'].includes(customId)) {
                if (!interaction.member.permissions.has('Administrator')) {
                    return interaction.reply({ content: '❌ هذه الأزرار مخصصة للإدارة فقط!', ephemeral: true });
                }
                if (customId === 'check_clean') {
                    checkStats.clean += 1;
                    checkStats.pending = Math.max(0, checkStats.pending - 1);
                    return interaction.update({ content: `🟢 **تم تحديد الحالة بواسطة ${interaction.user}: اللاعب نظيف (Clean)!**`, components: [] });
                } else if (customId === 'check_cheater') {
                    checkStats.cheaters += 1;
                    checkStats.pending = Math.max(0, checkStats.pending - 1);
                    return interaction.update({ content: `🔴 **تم تحديد الحالة بواسطة ${interaction.user}: ثبت أنه غشاش (Cheater)!**`, components: [] });
                } else if (customId === 'check_cancel') {
                    checkStats.pending = Math.max(0, checkStats.pending - 1);
                    return interaction.update({ content: `❌ **تم إلغاء البلاغ بواسطة ${interaction.user}.**`, components: [] });
                }
            }
        }

        // --- 3. استقبال نماذج المودال (Modals) ---
        if (interaction.isModalSubmit()) {
            const { customId } = interaction;

            // استلام معلومات الروم من الهوست
            if (customId.startsWith('modal_room_info_')) {
                const matchId = customId.split('_')[3];
                const match = activeMatches.get(matchId);

                if (!match) {
                    return interaction.reply({ content: '❌ هذه المباراة غير موجودة.', ephemeral: true });
                }

                const roomId = interaction.fields.getTextInputValue('room_id').trim();
                const password = interaction.fields.getTextInputValue('room_password')?.trim() || '';
                const privateKey = interaction.fields.getTextInputValue('private_key')?.trim() || '';

                if (!/^\d+$/.test(roomId)) {
                    return interaction.reply({ content: '❌ يجب أن يتكون Room ID من أرقام فقط!', ephemeral: true });
                }

                if (match.infoTimeout) clearTimeout(match.infoTimeout);

                // حذف رسالة الإنشاء الأولية فوراً
                if (match.promptMessageId) {
                    const promptMsg = await interaction.channel.messages.fetch(match.promptMessageId).catch(() => null);
                    if (promptMsg) {
                        await promptMsg.delete().catch(() => {});
                    }
                }

                match.roomId = roomId;
                match.password = password;
                match.privateKey = privateKey;
                match.state = 'LOBBY';

                // إضافة الهوست تلقائياً لتيم 1
                match.team1.push(match.hostId);

                // إرسال اللوبي في الشات مع منشن للرتبة إن وجدت
                const seasonRole = interaction.guild.roles.cache.find(r => r.name.toLowerCase().includes('season') || r.name.toLowerCase().includes('apostado'));
                const roleMention = seasonRole ? `<@&${seasonRole.id}>` : '@here';

                const lobbyEmbed = buildLobbyEmbed(match, interaction.guild);
                const lobbyButtons = buildLobbyButtons(match);

                await interaction.deferUpdate();

                const lobbyMsg = await interaction.channel.send({
                    content: `${roleMention}`,
                    embeds: [lobbyEmbed],
                    components: [lobbyButtons]
                });

                match.lobbyMessageId = lobbyMsg.id;

                // مؤقت دقيقتين لملء الفرق (2 Minutes Timeout)
                match.lobbyTimeout = setTimeout(async () => {
                    const currentMatch = activeMatches.get(matchId);
                    if (currentMatch && currentMatch.state === 'LOBBY') {
                        activeMatches.delete(matchId);

                        const timeoutEmbed = new EmbedBuilder()
                            .setColor(0xED4245)
                            .setTitle('❌ Match Cancelled - Timeout')
                            .setDescription(`**${match.mode}** match created by <@${match.hostId}> was automatically cancelled.\n\n⏰ **Reason:** Teams did not fill up within 2 minutes.\n\nUse \`!play ${match.mode.toLowerCase()}\` to start a new match.`)
                            .setFooter({ text: new Date().toLocaleString() });

                        const expiredRow = new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId('expired_btn').setLabel('Match Expired').setStyle(ButtonStyle.Secondary).setDisabled(true)
                        );

                        await lobbyMsg.edit({ embeds: [timeoutEmbed], components: [expiredRow] }).catch(() => {});
                    }
                }, 120000);
            }

            // التحقق من البرايفت كي عند الانضمام
            if (customId.startsWith('modal_join_key_')) {
                const parts = customId.split('_');
                const matchId = parts[3];
                const teamNum = parseInt(parts[4]);
                const match = activeMatches.get(matchId);

                if (!match || match.state !== 'LOBBY') {
                    return interaction.reply({ content: '❌ الماتش لم يعد متاحاً.', ephemeral: true });
                }

                const enteredKey = interaction.fields.getTextInputValue('entered_key').trim();
                if (enteredKey !== match.privateKey) {
                    return interaction.reply({ content: '❌ مفتاح الدخول غير صحيح!', ephemeral: true });
                }

                return handleTeamJoin(interaction, match, teamNum);
            }
        }

        // --- 4. القوائم المنسدلة والتصويت بالأغلبية ---
        if (interaction.isStringSelectMenu()) {
            const { customId, values } = interaction;

            // قائمة الإجراءات داخل ثريد الماتش
            if (customId.startsWith('match_action_select_')) {
                const matchId = customId.split('_')[3];
                const match = activeMatches.get(matchId);
                const selectedAction = values[0];

                if (!match) {
                    return interaction.reply({ content: '❌ المباراة غير نشطة.', ephemeral: true });
                }

                const allPlayers = [...match.team1, ...match.team2];
                const isParticipant = allPlayers.includes(interaction.user.id);
                const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);

                // 1. تصويت MVP Winners
                if (selectedAction === 'mvp_winners') {
                    if (!isParticipant && !isAdmin) {
                        return interaction.reply({ content: '❌ فقط المشاركون في المباراة أو الإدارة يمكنهم التصويت!', ephemeral: true });
                    }

                    const team1Options = await Promise.all(match.team1.map(async uid => {
                        const m = await interaction.guild.members.fetch(uid).catch(() => null);
                        return { label: `Team 1 Won: ${m ? m.displayName : uid}`, value: `t1_mvp_${uid}`, emoji: '🔴' };
                    }));

                    const team2Options = await Promise.all(match.team2.map(async uid => {
                        const m = await interaction.guild.members.fetch(uid).catch(() => null);
                        return { label: `Team 2 Won: ${m ? m.displayName : uid}`, value: `t2_mvp_${uid}`, emoji: '🟢' };
                    }));

                    const mvpSelect = new StringSelectMenuBuilder()
                        .setCustomId(`select_winner_player_${matchId}`)
                        .setPlaceholder('اختر الفريق الفائز والـ MVP...')
                        .addOptions([...team1Options, ...team2Options]);

                    return interaction.reply({
                        content: '🏆 **اختر الفريق الفائز وأفضل لاعب (MVP):**',
                        components: [new ActionRowBuilder().addComponents(mvpSelect)],
                        ephemeral: true
                    });
                }

                // 2. تصويت MVP Losers
                if (selectedAction === 'mvp_losers') {
                    if (!isParticipant && !isAdmin) {
                        return interaction.reply({ content: '❌ فقط المشاركون في المباراة أو الإدارة يمكنهم التصويت!', ephemeral: true });
                    }

                    const allOptions = await Promise.all(allPlayers.map(async uid => {
                        const m = await interaction.guild.members.fetch(uid).catch(() => null);
                        const isT1 = match.team1.includes(uid);
                        return { label: `${isT1 ? 'Team 1' : 'Team 2'}: ${m ? m.displayName : uid}`, value: `loser_mvp_${uid}`, emoji: isT1 ? '🔴' : '🟢' };
                    }));

                    const loserSelect = new StringSelectMenuBuilder()
                        .setCustomId(`select_loser_player_${matchId}`)
                        .setPlaceholder('اختر أفضل لاعب من الفريق الخاسر (MVP Loser)...')
                        .addOptions(allOptions);

                    return interaction.reply({
                        content: '🎖️ **اختر أفضل لاعب (MVP) من الفريق الخاسر:**',
                        components: [new ActionRowBuilder().addComponents(loserSelect)],
                        ephemeral: true
                    });
                }

                // 3. طلب مساعدة الإدارة Call Staff
                if (selectedAction === 'call_staff') {
                    const staffRole = interaction.guild.roles.cache.find(r => r.name.toLowerCase().includes('staff') || r.name.toLowerCase().includes('admin'));
                    const staffMention = staffRole ? `<@&${staffRole.id}>` : '@here';
                    await interaction.channel.send({ content: `🚨 **طلب تدخل إداري:** اللاعب ${interaction.user} استدعى طاقم الإدارة! ${staffMention}` });
                    return interaction.reply({ content: '📞 تم إرسال نداء فوري لطاقم الإدارة.', ephemeral: true });
                }

                // 4. إعادة تعيين التصويت Reset MVP Vote
                if (selectedAction === 'reset_mvp') {
                    if (!isAdmin && interaction.user.id !== match.hostId) {
                        return interaction.reply({ content: '❌ فقط الإدارة أو منشئ المباراة يمكنهم إعادة ضبط التصويت!', ephemeral: true });
                    }
                    match.winnerVotes.clear();
                    match.loserVotes.clear();
                    match.votingCompleted = false;
                    return interaction.reply({ content: '🔄 تم إعادة تعيين أصوات MVP بنجاح.', ephemeral: true });
                }

                // 5. إلغاء المباراة من الإدارة Staff Cancel
                if (selectedAction === 'staff_cancel') {
                    if (!isAdmin) {
                        return interaction.reply({ content: '❌ هذا الإجراء مخصص لطاقم الإدارة فقط!', ephemeral: true });
                    }
                    activeMatches.delete(matchId);
                    await interaction.channel.send({ content: `🛑 **تم إلغاء المباراة رسمياً وإغلاق الروم بواسطة الإدارة:** ${interaction.user}\n🔒 سيتم إعادة اللاعبين وحذف الغرفة المؤقتة خلال 5 ثوانٍ...` });
                    await returnPlayersToWaiting(interaction.guild, match);
                    setTimeout(async () => {
                        try { await interaction.channel.delete(); } catch (e) {}
                    }, 5000);
                    return interaction.reply({ content: '✅ تم إلغاء المباراة وإغلاق الروم.', ephemeral: true });
                }
            }

            // استقبال صوت الفائز والـ MVP (نظام الأغلبية)
            if (customId.startsWith('select_winner_player_')) {
                const matchId = customId.split('_')[3];
                const match = activeMatches.get(matchId);
                const selectedVal = values[0];

                if (!match) return interaction.reply({ content: '❌ المباراة غير نشطة.', ephemeral: true });

                const isT1Winner = selectedVal.startsWith('t1_mvp_');
                const mvpUid = selectedVal.replace('t1_mvp_', '').replace('t2_mvp_', '');
                const voterId = interaction.user.id;

                match.winnerVotes.set(voterId, {
                    voterTeam: match.team1.includes(voterId) ? 1 : 2,
                    winningTeam: isT1Winner ? 'Team 1' : 'Team 2',
                    mvpUid: mvpUid
                });

                const totalPlayers = match.team1.length + match.team2.length;
                const requiredVotes = Math.ceil((totalPlayers + 1) / 2);

                // حساب الأصوات الحالية
                let t1Votes = 0;
                let t2Votes = 0;
                const mvpCounts = {};

                for (const v of match.winnerVotes.values()) {
                    if (v.winningTeam === 'Team 1') t1Votes++;
                    else if (v.winningTeam === 'Team 2') t2Votes++;
                    mvpCounts[v.mvpUid] = (mvpCounts[v.mvpUid] || 0) + 1;
                }

                await interaction.reply({ 
                    content: `✅ تم تسجيل تصويتك لـ **${isT1Winner ? 'Team 1' : 'Team 2'}** والـ MVP <@${mvpUid}>!\n📊 **الأصوات الحالية:** Team 1 (${t1Votes}) | Team 2 (${t2Votes}) — المطلوب للأغلبية: **${requiredVotes}** أصوات`, 
                    ephemeral: true 
                });

                // التحقق من وصول الأغلبية
                const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);
                const isMajority = t1Votes >= requiredVotes || t2Votes >= requiredVotes || (totalPlayers <= 2 && match.winnerVotes.size >= 2) || isAdmin;

                if (isMajority && !match.votingCompleted) {
                    match.votingCompleted = true;
                    const finalWinningTeamName = t1Votes >= t2Votes ? 'Team 1' : 'Team 2';
                    const isFinalT1 = finalWinningTeamName === 'Team 1';
                    const winningPlayers = isFinalT1 ? match.team1 : match.team2;
                    const losingPlayers = isFinalT1 ? match.team2 : match.team1;

                    // تحديد MVP الفائز بالأكثر أصواتاً
                    let finalMvpWinner = mvpUid;
                    let maxMvpVotes = 0;
                    for (const [candidate, count] of Object.entries(mvpCounts)) {
                        if (count > maxMvpVotes && winningPlayers.includes(candidate)) {
                            maxMvpVotes = count;
                            finalMvpWinner = candidate;
                        }
                    }

                    // تحديد MVP الخاسر بالأصوات إن وجدت
                    const loserCounts = {};
                    for (const lUid of match.loserVotes.values()) {
                        loserCounts[lUid] = (loserCounts[lUid] || 0) + 1;
                    }
                    let finalMvpLoser = null;
                    let maxLoserVotes = 0;
                    for (const [candidate, count] of Object.entries(loserCounts)) {
                        if (count > maxLoserVotes && losingPlayers.includes(candidate)) {
                            maxLoserVotes = count;
                            finalMvpLoser = candidate;
                        }
                    }

                    // تحديث الإحصائيات في قاعدة البيانات
                    await updateMatchStats(interaction.guild.id, winningPlayers, losingPlayers, finalMvpWinner, finalMvpLoser, match.hostId);

                    const winEmbed = new EmbedBuilder()
                        .setColor(0x00FF00)
                        .setTitle('🏆 MATCH CONCLUDED & STATS SAVED!')
                        .setDescription(`🎉 **الفريق الفائز:** ${finalWinningTeamName} (${Math.max(t1Votes, t2Votes)} أصوات)\n🌟 **MVP الفائز (+45 pts):** <@${finalMvpWinner}>\n${finalMvpLoser ? `🎖️ **MVP الخاسر (+10 pts):** <@${finalMvpLoser}>\n` : ''}\nتم تسجيل النقاط والفوز لجميع المشاركين بنجاح!\n\n🔄 **جاري إعادة جميع اللاعبين إلى غرف الانتظار (waiting)...**\n🔒 **سيتم إغلاق وحذف هذه الغرفة المؤقتة خلال 15 ثانية...**`)
                        .setFooter({ text: 'Apostado Manager System' })
                        .setTimestamp();

                    await interaction.channel.send({ embeds: [winEmbed] });

                    // إعادة جميع اللاعبين إلى الـ waiting
                    await returnPlayersToWaiting(interaction.guild, match);

                    // قفل وحذف الغرفة المؤقتة بعد 15 ثانية
                    setTimeout(async () => {
                        try {
                            activeMatches.delete(matchId);
                            await interaction.channel.delete('Temporary match channel closed.');
                        } catch (e) {}
                    }, 15000);
                }
                return;
            }

            // استقبال اختيار MVP الخاسر
            if (customId.startsWith('select_loser_player_')) {
                const matchId = customId.split('_')[3];
                const match = activeMatches.get(matchId);
                const selectedVal = values[0];
                const mvpLoserUid = selectedVal.replace('loser_mvp_', '');

                if (!match) return interaction.reply({ content: '❌ المباراة غير نشطة.', ephemeral: true });

                match.loserVotes.set(interaction.user.id, mvpLoserUid);
                return interaction.reply({ content: `🎖️ تم تسجيل تصويتك لـ MVP الفريق الخاسر: <@${mvpLoserUid}>!`, ephemeral: true });
            }

            if (customId === 'select_suspect_platform') {
                let session = activeCheckSessions.get(interaction.user.id) || { suspectId: null, platform: null };
                session.platform = values[0];
                activeCheckSessions.set(interaction.user.id, session);
                return interaction.update({ content: `✅ تم اختيار المنصة: **${session.platform}**. اضغط الآن على Send Check لإرسال البلاغ.` });
            }
        }

        if (interaction.isUserSelectMenu() && interaction.customId === 'select_suspect_user') {
            let session = activeCheckSessions.get(interaction.user.id) || { suspectId: null, platform: null };
            session.suspectId = interaction.values[0];
            activeCheckSessions.set(interaction.user.id, session);
            return interaction.update({ content: `✅ تم اختيار اللاعب بنجاح. اختر المنصة الآن واضغط Send Check.` });
        }

    } catch (err) {
        console.error('Interaction error:', err);
        if (!interaction.replied && !interaction.deferred) {
            interaction.reply({ content: '❌ حدث خطأ غير متوقع أثناء معالجة الطلب.', ephemeral: true }).catch(() => {});
        }
    }
});

// معالجة الانضمام للفرق
async function handleTeamJoin(interaction, match, teamNum) {
    const uid = interaction.user.id;
    const team = teamNum === 1 ? match.team1 : match.team2;
    const otherTeam = teamNum === 1 ? match.team2 : match.team1;

    if (team.includes(uid)) {
        return interaction.reply({ content: 'ℹ️ أنت منضم بالفعل في هذا الفريق!', ephemeral: true });
    }

    if (team.length >= match.teamSize) {
        return interaction.reply({ content: '❌ هذا الفريق ممتلئ بالفعل!', ephemeral: true });
    }

    const idx = otherTeam.indexOf(uid);
    if (idx !== -1) {
        otherTeam.splice(idx, 1);
    }

    team.push(uid);

    await interaction.reply({ content: `✅ تم انضمامك إلى **Team ${teamNum}** بنجاح!`, ephemeral: true });
    await updateLobbyMessage(interaction.guild, match);

    // التحقق من اكتمال الفريقين وبدء المباراة فوراً
    if (match.team1.length === match.teamSize && match.team2.length === match.teamSize) {
        if (match.lobbyTimeout) clearTimeout(match.lobbyTimeout);
        match.state = 'IN_PROGRESS';
        await startMatch(interaction.guild, match);
    }
}

// بناء رسالة اللوبي بتصميم عريض ومطابق 100% للشاشات الأصلية
function buildLobbyEmbed(match, guild) {
    const t1List = match.team1.length > 0 
        ? match.team1.map(id => `<@${id}>`).join('\n') 
        : '*No players yet*';

    const t2List = match.team2.length > 0 
        ? match.team2.map(id => `<@${id}>`).join('\n') 
        : '*No players yet*';

    const divider = '────────────────────────────────────────';

    return new EmbedBuilder()
        .setColor('#2f3136')
        .setTitle(`👾 Free Fire ${match.mode} Match`)
        .setDescription(`| Match started by <@${match.hostId}>\n\n${divider}\n\n🔴 **Team 1 (${match.team1.length}/${match.teamSize})**\n${t1List}\n\n🟢 **Team 2 (${match.team2.length}/${match.teamSize})**\n${t2List}\n\n${divider}`)
        .setFooter({ text: 'Apostado Manager • Match Lobby' });
}

// بناء أزرار اللوبي مع تعطيل الزر في حال امتلاء الفريق
function buildLobbyButtons(match) {
    const isT1Full = match.team1.length >= match.teamSize;
    const isT2Full = match.team2.length >= match.teamSize;
    const isAllFull = isT1Full && isT2Full;

    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`join_team1_${match.id}`)
            .setLabel('Join Team 1')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(isT1Full),
        new ButtonBuilder()
            .setCustomId(`join_team2_${match.id}`)
            .setLabel('Join Team 2')
            .setStyle(ButtonStyle.Success)
            .setDisabled(isT2Full),
        new ButtonBuilder()
            .setCustomId(`leave_match_${match.id}`)
            .setLabel('Leave')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(isAllFull),
        new ButtonBuilder()
            .setCustomId(`cancel_match_${match.id}`)
            .setLabel('Cancel Game')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(isAllFull)
    );
}

async function updateLobbyMessage(guild, match) {
    try {
        const channel = await guild.channels.fetch(match.channelId).catch(() => null);
        if (!channel || !match.lobbyMessageId) return;

        const msg = await channel.messages.fetch(match.lobbyMessageId).catch(() => null);
        if (!msg) return;

        const embed = buildLobbyEmbed(match, guild);
        const buttons = buildLobbyButtons(match);

        await msg.edit({ embeds: [embed], components: [buttons] });
    } catch (e) {
        console.error('Error updating lobby message:', e);
    }
}

// إعادة اللاعبين إلى غرف الانتظار waiting
async function returnPlayersToWaiting(guild, match) {
    try {
        const waitingChannels = guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice && c.name.toLowerCase().includes('waiting'));
        const defaultWaiting = waitingChannels.first();

        const allPlayers = [...match.team1, ...match.team2];
        for (const uid of allPlayers) {
            const member = await guild.members.fetch(uid).catch(() => null);
            if (member && member.voice && member.voice.channel) {
                const originalId = match.originalVoiceChannels?.get(uid);
                const targetChannel = (originalId ? guild.channels.cache.get(originalId) : null) || defaultWaiting;
                if (targetChannel) {
                    await member.voice.setChannel(targetChannel).catch(() => {});
                }
            }
        }
    } catch (e) {
        console.error('Error returning players to waiting voice:', e);
    }
}

// بدء المباراة والبحث عن رومات Team 1 و Team 2 الفارغة والنقل وإنشاء الثريد
async function startMatch(guild, match) {
    try {
        const playChannel = await guild.channels.fetch(match.channelId).catch(() => null);
        if (!playChannel) return;

        // حفظ الروم الصوتي الأصلي (waiting) لكل لاعب قبل النقل
        const allParticipants = [...match.team1, ...match.team2];
        for (const uid of allParticipants) {
            const member = await guild.members.fetch(uid).catch(() => null);
            if (member?.voice?.channel) {
                match.originalVoiceChannels.set(uid, member.voice.channel.id);
            }
        }

        // تحديث رسالة اللوبي لتعطيل جميع الأزرار
        await updateLobbyMessage(guild, match);

        // 1. إرسال رسالة Match Ready في شات اللعب
        const readyEmbed = new EmbedBuilder()
            .setColor('#2f3136')
            .setTitle('✔ Match Ready!')
            .setDescription('Moving players to voice channels...')
            .setFooter({ text: new Date().toLocaleString() });

        await playChannel.send({ embeds: [readyEmbed] });

        // 2. البحث عن غرفتين فارغتين Team 1 و Team 2
        const t1Channels = guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice && c.name.toLowerCase().includes('team 1')).sort((a, b) => a.position - b.position);
        const t2Channels = guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice && c.name.toLowerCase().includes('team 2')).sort((a, b) => a.position - b.position);

        let selectedT1Voice = null;
        let selectedT2Voice = null;

        // البحث عن زوج غرف فارغ تماماً
        for (const ch1 of t1Channels.values()) {
            if (ch1.members.size === 0) {
                const ch2 = t2Channels.find(c => (c.parentId === ch1.parentId || !ch1.parentId) && c.members.size === 0 && Math.abs(c.position - ch1.position) <= 2);
                if (ch2) {
                    selectedT1Voice = ch1;
                    selectedT2Voice = ch2;
                    break;
                }
            }
        }

        if (!selectedT1Voice) selectedT1Voice = t1Channels.find(c => c.members.size === 0) || t1Channels.first();
        if (!selectedT2Voice) selectedT2Voice = t2Channels.find(c => c.members.size === 0 && c.id !== selectedT1Voice?.id) || t2Channels.first();

        match.team1VoiceId = selectedT1Voice?.id;
        match.team2VoiceId = selectedT2Voice?.id;

        // نقل لاعبي Team 1
        for (const uid of match.team1) {
            const member = await guild.members.fetch(uid).catch(() => null);
            if (member && member.voice && member.voice.channel && selectedT1Voice) {
                await member.voice.setChannel(selectedT1Voice).catch(() => {});
            }
        }

        // نقل لاعبي Team 2
        for (const uid of match.team2) {
            const member = await guild.members.fetch(uid).catch(() => null);
            if (member && member.voice && member.voice.channel && selectedT2Voice) {
                await member.voice.setChannel(selectedT2Voice).catch(() => {});
            }
        }

        // 3. إنشاء الثريد الخاص المؤقت للمباراة
        let thread;
        try {
            thread = await playChannel.threads.create({
                name: `Match ${match.id}`,
                autoArchiveDuration: 60,
                type: ChannelType.PrivateThread,
                reason: `Private thread for Free Fire Match ${match.id}`
            });
        } catch (threadErr) {
            thread = await playChannel.threads.create({
                name: `Match ${match.id}`,
                autoArchiveDuration: 60,
                reason: `Thread for Free Fire Match ${match.id}`
            });
        }

        match.threadId = thread.id;

        // إضافة المشاركين إلى الثريد
        for (const uid of allParticipants) {
            await thread.members.add(uid).catch(() => {});
        }

        // 4. تجميع المنشن (Owners, Staff, Participants)
        const owners = guild.members.cache.filter(m => m.id === guild.ownerId).map(m => `<@${m.id}>`).join(' ') || `<@${guild.ownerId}>`;
        const staffMembers = guild.members.cache.filter(m => m.permissions.has(PermissionFlagsBits.ManageGuild) && !m.user.bot).map(m => `<@${m.id}>`).slice(0, 15).join(' ') || 'None';
        const participantMentions = allParticipants.map(uid => `<@${uid}>`).join(' ');

        await thread.send({
            content: `**Owners Mention**\n${owners}\n\n**Staff Mention**\n${staffMembers}\n\n**Participant Mention**\n${participantMentions}`
        });

        // 5. إرسال لوحة بدء المباراة (Match Started Embed)
        const t1Display = match.team1.map(id => `<@${id}>`).join('\n');
        const t2Display = match.team2.map(id => `<@${id}>`).join('\n');

        const matchStartedEmbed = new EmbedBuilder()
            .setColor('#2b2d31')
            .setTitle(`👾 Free Fire ${match.mode} Match Started!`)
            .setDescription(`🔴 **Team 1:**\n${t1Display}\n\n🟢 **Team 2:**\n${t2Display}\n\nPress Button to access your voice team\n\n*Good luck and have fun!*`);

        const voiceButtonsRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Team 1 Voice ↗')
                .setStyle(ButtonStyle.Link)
                .setURL(selectedT1Voice ? `https://discord.com/channels/${guild.id}/${selectedT1Voice.id}` : `https://discord.com/channels/${guild.id}`),
            new ButtonBuilder()
                .setLabel('Team 2 Voice ↗')
                .setStyle(ButtonStyle.Link)
                .setURL(selectedT2Voice ? `https://discord.com/channels/${guild.id}/${selectedT2Voice.id}` : `https://discord.com/channels/${guild.id}`)
        );

        await thread.send({ embeds: [matchStartedEmbed], components: [voiceButtonsRow] });

        // 6. قائمة الإجراءات ومعلومات الروم
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`match_action_select_${match.id}`)
            .setPlaceholder('Select Action')
            .addOptions([
                {
                    label: 'MVP Winners',
                    description: 'Vote for the best player from winning team',
                    value: 'mvp_winners',
                    emoji: '👾'
                },
                {
                    label: 'MVP Losers',
                    description: 'Vote for the best player from losing team',
                    value: 'mvp_losers',
                    emoji: '🔴'
                },
                {
                    label: 'Call Staff',
                    description: 'Request staff assistance',
                    value: 'call_staff',
                    emoji: '📞'
                },
                {
                    label: 'Reset MVP Vote',
                    description: 'Reset active MVP voting',
                    value: 'reset_mvp',
                    emoji: '✔'
                },
                {
                    label: 'Staff Cancel Match',
                    description: 'Staff only - cancel match immediately',
                    value: 'staff_cancel',
                    emoji: '🛑'
                }
            ]);

        const menuRow = new ActionRowBuilder().addComponents(selectMenu);

        const roomInfoEmbed = new EmbedBuilder()
            .setColor('#2b2d31')
            .setTitle('👾 Room Information')
            .setDescription(`**Room ID :** \`${match.roomId}\`\n**Password :** \`${match.password || 'None'}\``)
            .addFields(
                {
                    name: 'How to check someone :',
                    value: 'open a ticket with check for cheating\n`# check-services`',
                    inline: false
                },
                {
                    name: 'ℹ Voice Channel Note',
                    value: 'Players will remain in their current voice channels after the match ends. You are free to leave or stay as you wish',
                    inline: false
                }
            )
            .setFooter({ text: new Date().toLocaleString() });

        const copyInfoRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`copy_room_info_${match.id}`)
                .setLabel('Copy Info')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('📑')
        );

        await thread.send({
            content: '🪵 **Use the menu below to vote or report problems**',
            embeds: [roomInfoEmbed],
            components: [menuRow, copyInfoRow]
        });

    } catch (err) {
        console.error('Error starting match:', err);
    }
}

client.login(process.env.DISCORD_TOKEN);