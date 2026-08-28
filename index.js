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
let createCanvas, loadImage;
let hasCanvas = false;
try {
    const canvasModule = require('@napi-rs/canvas');
    createCanvas = canvasModule.createCanvas;
    loadImage = canvasModule.loadImage;
    hasCanvas = true;
} catch (err) {
    console.warn('⚠️ @napi-rs/canvas is not installed or failed to load. The bot will use Embeds as fallback for profile cards. Error:', err.message);
}
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

// منع توقف البوت عند حدوث أي خطأ في الاتصال أو التفاعلات (Crash Prevention)
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

client.on('error', (err) => {
    console.error('Discord Client Error:', err);
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

    db.run(`CREATE TABLE IF NOT EXISTS active_matches (
        matchId TEXT PRIMARY KEY,
        data TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS blacklist (
        userId TEXT,
        guildId TEXT,
        expiresAt INTEGER,
        reason TEXT,
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

// دوال البلاك ليست (Blacklist Database Functions)
function setUserBlacklist(userId, guildId, durationMinutes, reason = 'مخالفة القوانين') {
    return new Promise((resolve) => {
        const expiresAt = Date.now() + durationMinutes * 60 * 1000;
        db.run(`INSERT OR REPLACE INTO blacklist (userId, guildId, expiresAt, reason) VALUES (?, ?, ?, ?)`, [userId, guildId, expiresAt, reason], () => resolve());
    });
}

function removeUserBlacklist(userId, guildId) {
    return new Promise((resolve) => {
        db.run(`DELETE FROM blacklist WHERE userId = ? AND guildId = ?`, [userId, guildId], () => resolve());
    });
}

function isUserBlacklisted(userId, guildId) {
    return new Promise((resolve) => {
        db.get(`SELECT * FROM blacklist WHERE userId = ? AND guildId = ?`, [userId, guildId], (err, row) => {
            if (err || !row) return resolve({ blacklisted: false });
            if (Date.now() >= row.expiresAt) {
                db.run(`DELETE FROM blacklist WHERE userId = ? AND guildId = ?`, [userId, guildId]);
                return resolve({ blacklisted: false });
            }
            const remainingMs = row.expiresAt - Date.now();
            resolve({ blacklisted: true, remainingMs, reason: row.reason || 'مخالفة القوانين' });
        });
    });
}

function getBlacklistedUsers(guildId) {
    return new Promise((resolve) => {
        db.all(`SELECT * FROM blacklist WHERE guildId = ?`, [guildId], (err, rows) => {
            if (err || !rows) return resolve([]);
            const now = Date.now();
            const valid = [];
            for (const r of rows) {
                if (r.expiresAt > now) {
                    valid.push({ ...r, remainingMs: r.expiresAt - now });
                } else {
                    db.run(`DELETE FROM blacklist WHERE userId = ? AND guildId = ?`, [r.userId, r.guildId]);
                }
            }
            resolve(valid);
        });
    });
}

function formatRemainingTime(ms) {
    const totalSec = Math.ceil(ms / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    if (mins > 0) return `${mins} دقيقة و ${secs} ثانية`;
    return `${secs} ثانية`;
}

// دوال حفظ واسترجاع المباريات في قاعدة البيانات (Match Persistence)
function saveMatchToDb(match) {
    if (!match || !match.id) return;
    try {
        const serializable = {
            id: match.id,
            guildId: match.guildId,
            channelId: match.channelId,
            hostId: match.hostId,
            mode: match.mode,
            teamSize: match.teamSize,
            roomId: match.roomId,
            password: match.password,
            privateKey: match.privateKey,
            team1: match.team1 || [],
            team2: match.team2 || [],
            originalVoiceChannels: Array.from(match.originalVoiceChannels?.entries() || []),
            state: match.state,
            promptMessageId: match.promptMessageId,
            lobbyMessageId: match.lobbyMessageId,
            threadId: match.threadId,
            matchChannelId: match.matchChannelId || match.threadId,
            team1VoiceId: match.team1VoiceId,
            team2VoiceId: match.team2VoiceId,
            winnerVotes: Array.from(match.winnerVotes?.entries() || []),
            loserVotes: Array.from(match.loserVotes?.entries() || []),
            votingCompleted: match.votingCompleted || false
        };
        db.run(`INSERT OR REPLACE INTO active_matches (matchId, data) VALUES (?, ?)`, [match.id, JSON.stringify(serializable)]);
    } catch (e) {
        console.error('Error saving match to DB:', e);
    }
}

function removeMatchFromDb(matchId) {
    db.run(`DELETE FROM active_matches WHERE matchId = ?`, [matchId]);
}

function loadMatchesFromDb() {
    return new Promise((resolve) => {
        db.all(`SELECT * FROM active_matches`, [], (err, rows) => {
            if (err || !rows) return resolve();
            for (const row of rows) {
                try {
                    const parsed = JSON.parse(row.data);
                    parsed.originalVoiceChannels = new Map(parsed.originalVoiceChannels || []);
                    parsed.winnerVotes = new Map(parsed.winnerVotes || []);
                    parsed.loserVotes = new Map(parsed.loserVotes || []);
                    activeMatches.set(parsed.id, parsed);
                } catch (e) {}
            }
            console.log(`Restored ${rows.length} active matches from database.`);
            resolve();
        });
    });
}

// دالة فحص وجود مباراة حقيقية للاعب
function getRealActiveMatchForUser(guild, userId, excludeMatchId = null) {
    if (!guild) return null;
    for (const m of activeMatches.values()) {
        if (m.guildId === guild.id && (!excludeMatchId || m.id !== excludeMatchId) && (m.team1.includes(userId) || m.team2.includes(userId)) && !m.votingCompleted) {
            return m;
        }
    }
    return null;
}

// تنظيف تلقائي للمباريات عند قيام الإدارة بحذف أي روم ماتش يدوياً
client.on('channelDelete', (channel) => {
    for (const match of activeMatches.values()) {
        if (match.matchChannelId === channel.id || match.threadId === channel.id || match.channelId === channel.id) {
            activeMatches.delete(match.id);
            removeMatchFromDb(match.id);
            console.log(`Auto-cleaned match ${match.id} because channel ${channel.id} was deleted.`);
        }
    }
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
            const pts = isMvp ? 80 : 50;
            const mvpInc = isMvp ? 1 : 0;
            db.run(`UPDATE users SET points = points + ?, wins = wins + 1, matches = matches + 1, mvps = mvps + ? WHERE userId = ? AND guildId = ?`, [pts, mvpInc, uid, guildId]);
        });

        losers.forEach(uid => {
            const isMvp = uid === mvpLoserId;
            const pts = isMvp ? 30 : -30;
            const mvpInc = isMvp ? 1 : 0;
            db.run(`UPDATE users SET points = MAX(0, points + ?), losses = losses + 1, matches = matches + 1, mvps = mvps + ? WHERE userId = ? AND guildId = ?`, [pts, mvpInc, uid, guildId]);
        });

        if (hostId) {
            db.run(`UPDATE users SET organize = organize + 1, points = points + 5 WHERE userId = ? AND guildId = ?`, [hostId, guildId]);
        }
        resolve();
    });
}

// تنظيف صلاحيات الفويس وإعادة إغلاق الرومات للاعبين
async function cleanupMatchVoicePermissions(guild, match) {
    if (!guild || !match) return;
    try {
        if (match.team1VoiceId) {
            const v1 = guild.channels.cache.get(match.team1VoiceId) || await guild.channels.fetch(match.team1VoiceId).catch(() => null);
            if (v1 && v1.permissionOverwrites) {
                for (const uid of (match.team1 || [])) {
                    await v1.permissionOverwrites.delete(uid).catch(() => {});
                }
            }
        }
        if (match.team2VoiceId) {
            const v2 = guild.channels.cache.get(match.team2VoiceId) || await guild.channels.fetch(match.team2VoiceId).catch(() => null);
            if (v2 && v2.permissionOverwrites) {
                for (const uid of (match.team2 || [])) {
                    await v2.permissionOverwrites.delete(uid).catch(() => {});
                }
            }
        }
    } catch (e) {
        console.error('Error cleaning up match voice permissions:', e);
    }
}

// دالة إنهاء المباراة وتوزيع النقاط وإغلاق الروم
async function finalizeMatch(guild, match, channel = null) {
    if (!guild || !match || match.finalized) return;
    match.finalized = true;
    match.votingCompleted = true;

    const winningPlayers = match.winningTeam === 1 ? match.team1 : match.team2;
    const losingPlayers = match.winningTeam === 1 ? match.team2 : match.team1;
    const winningTeamName = match.winningTeam === 1 ? 'Team 1' : 'Team 2';
    const losingTeamName = match.winningTeam === 1 ? 'Team 2' : 'Team 1';

    await updateMatchStats(guild.id, winningPlayers, losingPlayers, match.winningMvpUid, match.losingMvpUid, match.hostId);

    const gameOverEmbed = new EmbedBuilder()
        .setColor('#2b2d31')
        .setTitle('🎮 GAME OVER - All MVPs Selected!')
        .setDescription(
            `🏆 **MVP Winners**\n<@${match.winningMvpUid}> (+80 points)\n\n` +
            `🎯 **MVP Losers**\n<@${match.losingMvpUid}> (+30 points)\n\n` +
            `✅ **Winners (${winningTeamName})**\n${winningPlayers.map(id => `<@${id}>`).join(' , ')}\nEach player received **+50 Win point!**\n\n` +
            `❌ **Losers (${losingTeamName})**\n${losingPlayers.map(id => `<@${id}>`).join(' , ')}\nEach player received **-30 Lose point.**\n\n` +
            `*Moving players back to original channels...*`
        )
        .setFooter({ text: 'Apostado Manager' })
        .setTimestamp();

    const targetChannel = channel || guild.channels.cache.get(match.matchChannelId || match.threadId);
    if (targetChannel) {
        await targetChannel.send({ embeds: [gameOverEmbed] }).catch(() => {});
    }

    // إعادة اللاعبين للغرف الصوتية
    await returnPlayersToWaiting(guild, match);

    // سحب صلاحيات الفويس من اللاعبين لإغلاقه مجدداً
    await cleanupMatchVoicePermissions(guild, match);

    activeMatches.delete(match.id);
    removeMatchFromDb(match.id);

    // إغلاق وحذف الروم / الـ Thread بعد 15 ثانية
    if (targetChannel) {
        setTimeout(async () => {
            try {
                await targetChannel.delete('Match finished and concluded.');
            } catch (e) {}
        }, 15000);
    }
}

// دالة مساعدة ذكية للعثور على المباراة من التفاعل أو الروم لتجنب أي أخطاء
function findMatchFromInteraction(interaction, prefix = null) {
    if (!interaction) return null;
    let matchId = null;
    if (prefix && interaction.customId?.startsWith(prefix)) {
        matchId = interaction.customId.replace(prefix, '');
        if (prefix.startsWith('modal_join_key_')) {
            matchId = matchId.replace(/_[12]$/, '');
        }
    }
    let match = matchId ? activeMatches.get(matchId) : null;
    if (!match && interaction.customId) {
        for (const [id, m] of activeMatches.entries()) {
            if (interaction.customId.includes(id)) {
                match = m;
                break;
            }
        }
    }
    if (!match && interaction.guild) {
        const chId = interaction.channelId || interaction.channel?.id;
        if (chId) {
            match = Array.from(activeMatches.values()).find(m => 
                m.guildId === interaction.guild.id && (m.matchChannelId === chId || m.threadId === chId || m.channelId === chId)
            );
        }
    }
    return match;
}

// دالة توليد بطاقة الكانفاس للبروفايل !p
async function generateProfileCard(user, member, stats) {
    if (!hasCanvas || !createCanvas || !loadImage) {
        return null;
    }
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
const voiceJoinTimes = new Map();
let checkStats = { pending: 1, cheaters: 7, clean: 5 };

client.on('voiceStateUpdate', async (oldState, newState) => {
    const userId = newState.id || oldState.id;
    const guildId = newState.guild.id || oldState.guild.id;
    const key = `${userId}_${guildId}`;

    if (!oldState.channelId && newState.channelId) {
        voiceJoinTimes.set(key, Date.now());
    } else if (oldState.channelId && !newState.channelId) {
        const joinTime = voiceJoinTimes.get(key);
        if (joinTime) {
            const durationSec = Math.floor((Date.now() - joinTime) / 1000);
            voiceJoinTimes.delete(key);
            db.run(`UPDATE users SET voiceTime = voiceTime + ? WHERE userId = ? AND guildId = ?`, [durationSec, userId, guildId]);
        }
    }

});

client.once('ready', async () => {
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
            ),
        new SlashCommandBuilder()
            .setName('blacklist')
            .setDescription('إدارة قائمة الحظر المؤقت (Blacklist)')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
            .addSubcommand(sub =>
                sub.setName('add')
                    .setDescription('إضافة لاعب إلى قائمة الحظر')
                    .addUserOption(opt => opt.setName('user').setDescription('اللاعب المراد حظره').setRequired(true))
                    .addIntegerOption(opt => opt.setName('minutes').setDescription('مدة الحظر بالدقائق (مثال: 15)').setRequired(true))
                    .addStringOption(opt => opt.setName('reason').setDescription('سبب الحظر').setRequired(false))
            )
            .addSubcommand(sub =>
                sub.setName('remove')
                    .setDescription('إزالة لاعب من قائمة الحظر')
                    .addUserOption(opt => opt.setName('user').setDescription('اللاعب المراد فك حظره').setRequired(true))
            )
            .addSubcommand(sub =>
                sub.setName('list')
                    .setDescription('عرض قائمة اللاعبين المحظورين حالياً والوقت المتبقي')
            ),
        new SlashCommandBuilder()
            .setName('unblock')
            .setDescription('فك التعليق أو الحظر عن لاعب فوراً لحل مشكلة الماتشات المعلقة')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
            .addUserOption(opt => opt.setName('user').setDescription('اللاعب').setRequired(true)),
        new SlashCommandBuilder()
            .setName('clearmatches')
            .setDescription('تنظيف وإعادة ضبط جميع المباريات المعلقة وفك القفل عن جميع اللاعبين')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Slash commands registered successfully.');
    } catch (error) {
        console.error('Error registering slash commands:', error);
    }

    await loadMatchesFromDb();
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
            if (buffer) {
                const attachment = new AttachmentBuilder(buffer, { name: 'profile.png' });
                return message.reply({ files: [attachment] });
            } else {
                const totalMatches = stats.matches || (stats.wins + stats.losses);
                const winrate = totalMatches > 0 ? Math.round((stats.wins / totalMatches) * 100) : 0;
                const profileEmbed = new EmbedBuilder()
                    .setColor('#2b2d31')
                    .setTitle(`📊 بروفايل اللاعب | ${message.author.username}`)
                    .setThumbnail(message.author.displayAvatarURL({ extension: 'png', size: 256 }))
                    .addFields(
                        { name: '🏆 النقاط (Points)', value: `**${stats.points || 0}**`, inline: true },
                        { name: '⚔️ الانتصارات (Wins)', value: `**${stats.wins || 0}**`, inline: true },
                        { name: '💀 الهزائم (Losses)', value: `**${stats.losses || 0}**`, inline: true },
                        { name: '🎖️ MVP', value: `**${stats.mvps || 0}**`, inline: true },
                        { name: '🎮 المباريات', value: `**${totalMatches || 0}**`, inline: true },
                        { name: '📈 نسبة الفوز', value: `**${winrate}%**`, inline: true },
                        { name: '📋 تنظيم', value: `**${stats.organize || 0}**`, inline: true },
                        { name: '⭐ المستوى (Level)', value: `**${stats.level || 1}**`, inline: true },
                        { name: '💬 الرسائل', value: `**${stats.messages || 0}**`, inline: true }
                    )
                    .setFooter({ text: 'Apostado Manager', iconURL: message.guild.iconURL() })
                    .setTimestamp();
                return message.reply({ embeds: [profileEmbed] });
            }
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

    // أوامر البلاك ليست النصية للإدارة (!blacklist / !unblacklist / !bl)
    if (content.toLowerCase().startsWith('!blacklist') || content.toLowerCase().startsWith('!bl ') || content.toLowerCase().startsWith('!unblacklist') || content.toLowerCase().startsWith('!unbl ')) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply('❌ هذا الأمر مخصص لطاقم الإدارة فقط!');
        }

        const parts = content.trim().split(/\s+/);
        const cmd = parts[0].toLowerCase();

        if (cmd === '!blacklist' || cmd === '!bl') {
            if (parts[1]?.toLowerCase() === 'list') {
                const list = await getBlacklistedUsers(guildId);
                if (!list || list.length === 0) {
                    return message.reply('ℹ️ **لا يوجد أي لاعبين في قائمة البلاك ليست حالياً.**');
                }
                const desc = list.map((item, idx) => {
                    return `**#${idx + 1}** <@${item.userId}> (\`${item.userId}\`)\n⏳ **الوقت المتبقي:** \`${formatRemainingTime(item.remainingMs)}\`\n📝 **السبب:** \`${item.reason}\``;
                }).join('\n\n');
                const listEmbed = new EmbedBuilder()
                    .setColor('#ff0033')
                    .setTitle('📋 قائمة المحظورين حالياً (Blacklist)')
                    .setDescription(desc)
                    .setFooter({ text: `${message.guild.name} • Total: ${list.length}` })
                    .setTimestamp();
                return message.reply({ embeds: [listEmbed] });
            }

            const targetUser = message.mentions.users.first() || (parts[1] ? await client.users.fetch(parts[1]).catch(() => null) : null);
            if (!targetUser) {
                return message.reply('ℹ️ **الاستخدام:** `!blacklist @user [minutes] [reason]` أو `!blacklist list`');
            }

            const minutes = parseInt(parts[2]) || 15;
            const reason = parts.slice(3).join(' ') || 'مخالفة القوانين';

            await setUserBlacklist(targetUser.id, guildId, minutes, reason);

            const blEmbed = new EmbedBuilder()
                .setColor('#ff0033')
                .setTitle('⛔ تم إضافة اللاعب إلى البلاك ليست (Blacklist)')
                .setDescription(`👤 **اللاعب:** ${targetUser} (\`${targetUser.id}\`)\n⏰ **المدة:** \`${minutes}\` دقيقة\n📝 **السبب:** \`${reason}\`\n👑 **بواسطة:** ${message.author}`)
                .setFooter({ text: `${message.guild.name} • Blacklist System` })
                .setTimestamp();

            return message.reply({ embeds: [blEmbed] });
        }

        if (cmd === '!unblacklist' || cmd === '!unbl') {
            const targetUser = message.mentions.users.first() || (parts[1] ? await client.users.fetch(parts[1]).catch(() => null) : null);
            if (!targetUser) {
                return message.reply('ℹ️ **الاستخدام:** `!unblacklist @user`');
            }

            await removeUserBlacklist(targetUser.id, guildId);

            const unblEmbed = new EmbedBuilder()
                .setColor('#00ff88')
                .setTitle('✅ تم فك حظر اللاعب من البلاك ليست')
                .setDescription(`👤 **اللاعب:** ${targetUser} (\`${targetUser.id}\`)\n👑 **تم فك الحظر بواسطة:** ${message.author}`)
                .setFooter({ text: `${message.guild.name} • Blacklist System` })
                .setTimestamp();

            return message.reply({ embeds: [unblEmbed] });
        }
    }

    // أمر فك التعليق عن لاعب !unblock أو !free
    if (content.toLowerCase().startsWith('!unblock') || content.toLowerCase().startsWith('!free')) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply('❌ هذا الأمر مخصص لطاقم الإدارة فقط!');
        }

        const parts = content.trim().split(/\s+/);
        const targetUser = message.mentions.users.first() || (parts[1] ? await client.users.fetch(parts[1]).catch(() => null) : null);
        if (!targetUser) {
            return message.reply('ℹ️ **الاستخدام:** `!unblock @user` لفك التعليق أو البلاك ليست عن لاعب');
        }

        await removeUserBlacklist(targetUser.id, guildId);

        for (const m of activeMatches.values()) {
            if (m.guildId === guildId) {
                m.team1 = m.team1.filter(id => id !== targetUser.id);
                m.team2 = m.team2.filter(id => id !== targetUser.id);
                if (m.hostId === targetUser.id || (m.team1.length === 0 && m.team2.length === 0)) {
                    activeMatches.delete(m.id);
                    removeMatchFromDb(m.id);
                } else {
                    saveMatchToDb(m);
                }
            }
        }

        return message.reply(`✅ **تم فك التعليق والحظر عن ${targetUser} بنجاح!** يمكنه الآن إنشاء أو الانضمام لأي مباراة فوراً.`);
    }

    // أمر مسح جميع المباريات المعلقة وإعادة ضبط السيرفر !clearmatches أو !resetmatches
    if (content.toLowerCase() === '!clearmatches' || content.toLowerCase() === '!resetmatches') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply('❌ هذا الأمر مخصص لطاقم الإدارة فقط!');
        }

        let count = 0;
        for (const [id, m] of activeMatches.entries()) {
            if (m.guildId === guildId) {
                activeMatches.delete(id);
                removeMatchFromDb(id);
                count++;
            }
        }

        return message.reply(`🧹 **تم تنظيف جميع المباريات المعلقة (${count}) وفك التعليق عن جميع اللاعبين في السيرفر بنجاح!**`);
    }

    // أمر تعيين MVP Winner للإدارة !w
    if (content.toLowerCase().startsWith('!w ') || content.toLowerCase() === '!w') {
        const isAdmin = message.member.permissions.has(PermissionFlagsBits.ManageGuild) || 
                        message.member.permissions.has(PermissionFlagsBits.Administrator) ||
                        message.member.roles.cache.some(r => r.name.toLowerCase().includes('staff') || r.name.toLowerCase().includes('admin'));
        
        if (!isAdmin) {
            return message.reply('❌ هذا الأمر مخصص لطاقم الإدارة فقط!');
        }

        const parts = content.trim().split(/\s+/);
        const targetUser = message.mentions.users.first() || (parts[1] ? await client.users.fetch(parts[1]).catch(() => null) : null);
        if (!targetUser) {
            return message.reply('ℹ️ **الاستخدام:** `!w @user` لتحديد MVP الفائز للفريق الفائز.');
        }

        // البحث عن الماتش في القناة الحالية أو باللاعب
        let match = Array.from(activeMatches.values()).find(m => 
            m.guildId === guildId && (m.matchChannelId === message.channel.id || m.threadId === message.channel.id)
        );

        if (!match) {
            match = Array.from(activeMatches.values()).find(m => 
                m.guildId === guildId && (m.team1.includes(targetUser.id) || m.team2.includes(targetUser.id))
            );
        }

        if (!match) {
            return message.reply('❌ لم يتم العثور على مباراة نشطة لهذا اللاعب أو في هذه القناة.');
        }

        const isT1 = match.team1.includes(targetUser.id);
        const isT2 = match.team2.includes(targetUser.id);

        if (!isT1 && !isT2) {
            return message.reply(`❌ اللاعب <@${targetUser.id}> ليس مشاركاً في هذه المباراة (Match ID: \`${match.id}\`).`);
        }

        match.winningMvpUid = targetUser.id;
        match.winningTeam = isT1 ? 1 : 2;
        match.winnerVotingConcluded = true;
        saveMatchToDb(match);

        const bothSelected = !!match.losingMvpUid;

        const dateStr = new Date().toLocaleString('en-US', {
            month: 'numeric',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });

        const winEmbed = new EmbedBuilder()
            .setColor('#2b2d31')
            .setTitle('✔ MVP Winner Set')
            .setDescription(`✅ MVP Winner has been set to <@${targetUser.id}> by staff.\n\n**Match ID:** \`${match.id}\``)
            .setFooter({ text: dateStr });

        await message.channel.send({ embeds: [winEmbed] });

        if (bothSelected) {
            await message.channel.send({ content: '🎉 **Both MVPs selected! Finalizing match...**' });
            await finalizeMatch(message.guild, match, message.channel);
        }
        return;
    }

    // أمر تعيين MVP Loser للإدارة !l
    if (content.toLowerCase().startsWith('!l ') || content.toLowerCase() === '!l') {
        const isAdmin = message.member.permissions.has(PermissionFlagsBits.ManageGuild) || 
                        message.member.permissions.has(PermissionFlagsBits.Administrator) ||
                        message.member.roles.cache.some(r => r.name.toLowerCase().includes('staff') || r.name.toLowerCase().includes('admin'));
        
        if (!isAdmin) {
            return message.reply('❌ هذا الأمر مخصص لطاقم الإدارة فقط!');
        }

        const parts = content.trim().split(/\s+/);
        const targetUser = message.mentions.users.first() || (parts[1] ? await client.users.fetch(parts[1]).catch(() => null) : null);
        if (!targetUser) {
            return message.reply('ℹ️ **الاستخدام:** `!l @user` لتحديد MVP الخاسر للفريق الخاسر.');
        }

        // البحث عن الماتش في القناة الحالية أو باللاعب
        let match = Array.from(activeMatches.values()).find(m => 
            m.guildId === guildId && (m.matchChannelId === message.channel.id || m.threadId === message.channel.id)
        );

        if (!match) {
            match = Array.from(activeMatches.values()).find(m => 
                m.guildId === guildId && (m.team1.includes(targetUser.id) || m.team2.includes(targetUser.id))
            );
        }

        if (!match) {
            return message.reply('❌ لم يتم العثور على مباراة نشطة لهذا اللاعب أو في هذه القناة.');
        }

        const isT1 = match.team1.includes(targetUser.id);
        const isT2 = match.team2.includes(targetUser.id);

        if (!isT1 && !isT2) {
            return message.reply(`❌ اللاعب <@${targetUser.id}> ليس مشاركاً في هذه المباراة (Match ID: \`${match.id}\`).`);
        }

        match.losingMvpUid = targetUser.id;
        if (!match.winningTeam) {
            match.winningTeam = isT1 ? 2 : 1;
        }
        saveMatchToDb(match);

        const bothSelected = !!match.winningMvpUid;

        const dateStr = new Date().toLocaleString('en-US', {
            month: 'numeric',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });

        const loseEmbed = new EmbedBuilder()
            .setColor('#2b2d31')
            .setTitle('✔ MVP Loser Set')
            .setDescription(
                `✅ MVP Loser has been set to <@${targetUser.id}> by staff.\n\n**Match ID:** \`${match.id}\`` +
                (bothSelected ? '\n\n🎉 **Both MVPs selected! Finalizing match...**' : '')
            )
            .setFooter({ text: dateStr });

        await message.channel.send({ embeds: [loseEmbed] });

        if (bothSelected) {
            await finalizeMatch(message.guild, match, message.channel);
        }
        return;
    }

    // أمر إنشاء المباريات !play (فقط 2v2, 3v3, 4v4)
    if (content.toLowerCase().startsWith('!play') || content.toLowerCase().startsWith('! play')) {
        // التحقق من البلاك ليست
        const bl = await isUserBlacklisted(userId, guildId);
        if (bl.blacklisted) {
            return message.reply(`⛔ **أنت في قائمة الحظر (Blacklist)!**\n⏳ **متبقي على فك الحظر:** \`${formatRemainingTime(bl.remainingMs)}\`\n📝 **السبب:** \`${bl.reason}\``);
        }

        // التحقق من التواجد في مباراة نشطة حقيقية لم يكتمل تصويتها (مع تنظيف الرومات المحذوفة تلقائياً)
        const activeMatchForUser = getRealActiveMatchForUser(message.guild, userId);
        if (activeMatchForUser) {
            const chId = activeMatchForUser.matchChannelId || activeMatchForUser.threadId;
            return message.reply(`❌ **لا يمكنك إنشاء مباراة جديدة!**\nأنت مشارك بالفعل في مباراة نشطة (<#${chId}>) حتى ينتهي التصويت بالكامل.`);
        }

        const cleanContent = content.replace(/\s+/g, ' ').trim();
        const parts = cleanContent.split(' ');
        
        let modeArg = parts[1] ? parts[1].toLowerCase() : '';
        if (cleanContent.toLowerCase().startsWith('! play')) {
            modeArg = parts[2] ? parts[2].toLowerCase() : '';
        }

        const validModes = {
            '2v2': 2,
            '3v3': 3,
            '4v4': 4
        };

        if (!modeArg || !validModes[modeArg]) {
            const invalidEmbed = new EmbedBuilder()
                .setColor('#2b2d31')
                .setTitle('ℹ️ Invalid Mode')
                .setDescription('Please specify a valid mode: `!play 2v2`, `!play 3v3`, or `!play 4v4`')
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

                // حساب الوقت الصوتي
                let voiceSec = stats.voiceTime || 0;
                const currentJoin = voiceJoinTimes.get(`${targetUser.id}_${interaction.guild.id}`);
                if (currentJoin) {
                    voiceSec += Math.floor((Date.now() - currentJoin) / 1000);
                }
                const hours = Math.floor(voiceSec / 3600);
                const mins = Math.floor((voiceSec % 3600) / 60);
                const secs = voiceSec % 60;
                const voiceStr = hours > 0 ? `${hours}h ${mins}m ${secs}s` : `${mins}m ${secs}s`;

                // تاريخ الانضمام
                let joinedStr = 'Unknown';
                if (member && member.joinedTimestamp) {
                    joinedStr = `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>`;
                }

                // الرتب
                let rolesStr = 'No Roles';
                if (member) {
                    const memberRoles = member.roles.cache.filter(r => r.id !== interaction.guild.id);
                    if (memberRoles.size > 0) {
                        rolesStr = memberRoles.map(r => `<@&${r.id}>`).slice(0, 10).join(' ');
                    }
                }

                const embed = new EmbedBuilder()
                    .setColor('#2b2d31')
                    .setTitle(`📊 Profile — ${targetUser.username}`)
                    .setThumbnail(targetUser.displayAvatarURL({ size: 512 }))
                    .addFields(
                        { name: '⭐ Level', value: `${stats.level || 1}`, inline: true },
                        { name: '✨ XP', value: `${stats.xp || 0}`, inline: true },
                        { name: '🏆 Rank', value: `#${stats.rank || 1}`, inline: true },
                        { name: '💬 Messages', value: `${stats.messages || 0}`, inline: true },
                        { name: '🎙️ Voice Time', value: voiceStr, inline: true },
                        { name: '📅 Joined Server', value: joinedStr, inline: false },
                        { name: '🎭 Roles', value: rolesStr, inline: false }
                    )
                    .setFooter({ text: `${interaction.guild.name} • Management System`, iconURL: interaction.guild.iconURL() || client.user.displayAvatarURL() })
                    .setTimestamp();

                return interaction.editReply({ embeds: [embed] });
            }

            if (commandName === 'rank') {
                await interaction.deferReply();
                const targetUser = interaction.options.getUser('user') || interaction.user;
                const stats = await getUserStats(targetUser.id, interaction.guild.id);

                const nextLevelXp = (stats.level || 1) * 100;
                const currentXp = stats.xp || 0;

                const embed = new EmbedBuilder()
                    .setColor('#2b2d31')
                    .setTitle(`🏆 Rank Stats — ${targetUser.username}`)
                    .setDescription('إليك إحصائيات المستوى والـ XP يا أسطى!')
                    .setThumbnail(targetUser.displayAvatarURL({ size: 512 }))
                    .addFields(
                        { name: '⭐ Level', value: `${stats.level || 1}`, inline: true },
                        { name: '✨ XP', value: `${currentXp}`, inline: true },
                        { name: '📊 Server Rank', value: `#${stats.rank || 1}`, inline: true },
                        { name: '📈 Next Level', value: `${currentXp} / ${nextLevelXp} XP`, inline: false }
                    )
                    .setFooter({ text: `${interaction.guild.name} • Management System`, iconURL: interaction.guild.iconURL() || client.user.displayAvatarURL() })
                    .setTimestamp();
                return interaction.editReply({ embeds: [embed] });
            }

            if (commandName === 'leaderboard') {
                await interaction.deferReply();
                db.all(`SELECT * FROM users WHERE guildId = ? ORDER BY points DESC LIMIT 10`, [interaction.guild.id], async (err, rows) => {
                    if (err || !rows || rows.length === 0) {
                        return interaction.editReply({ content: '📊 لا توجد إحصائيات كافية بعد.' });
                    }
                    const desc = rows.map((r, i) => `**#${i + 1}** <@${r.userId}> — 🏆 **${r.points}** pts | ⚔️ **${r.wins}** W / **${r.losses}** L`).join('\n');
                    const topEmbed = new EmbedBuilder()
                        .setColor('#2b2d31')
                        .setTitle('🏆 Apostado Leaderboard')
                        .setDescription(desc)
                        .setFooter({ text: `${interaction.guild.name} • Management System`, iconURL: interaction.guild.iconURL() || client.user.displayAvatarURL() })
                        .setTimestamp();
                    return interaction.editReply({ embeds: [topEmbed] });
                });
                return;
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
                    .setDescription('تم إعطاء الرتبة بنجاح وعليها ختم الجوده يا أسطى!')
                    .setThumbnail(targetMember.user.displayAvatarURL({ size: 512 }))
                    .addFields(
                        { name: '👤 Target Member', value: `${targetMember} (\`${targetMember.user.username}\`)`, inline: false },
                        { name: '🛡️ Granted Role', value: `${targetRole}`, inline: true },
                        { name: '👑 Managed By', value: `${interaction.user}`, inline: true }
                    )
                    .setFooter({ text: `${interaction.guild.name} • Management System`, iconURL: interaction.guild.iconURL() || client.user.displayAvatarURL() })
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
                    .setDescription('تم سحب الرتبة بنجاح يا أسطى!')
                    .setThumbnail(targetMember.user.displayAvatarURL({ size: 512 }))
                    .addFields(
                        { name: '👤 Target Member', value: `${targetMember} (\`${targetMember.user.username}\`)`, inline: false },
                        { name: '🛡️ Removed Role', value: `${targetRole}`, inline: true },
                        { name: '👑 Managed By', value: `${interaction.user}`, inline: true }
                    )
                    .setFooter({ text: `${interaction.guild.name} • Management System`, iconURL: interaction.guild.iconURL() || client.user.displayAvatarURL() })
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

            if (commandName === 'blacklist') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                    return interaction.reply({ content: '❌ هذا الأمر مخصص لطاقم الإدارة فقط!', ephemeral: true });
                }
                const sub = interaction.options.getSubcommand();
                const guildId = interaction.guild.id;

                if (sub === 'add') {
                    const targetUser = interaction.options.getUser('user');
                    const minutes = interaction.options.getInteger('minutes');
                    const reason = interaction.options.getString('reason') || 'مخالفة القوانين';

                    await setUserBlacklist(targetUser.id, guildId, minutes, reason);

                    const blEmbed = new EmbedBuilder()
                        .setColor('#ff0033')
                        .setTitle('⛔ تم إضافة اللاعب إلى البلاك ليست (Blacklist)')
                        .setDescription(`👤 **اللاعب:** ${targetUser} (\`${targetUser.id}\`)\n⏰ **المدة:** \`${minutes}\` دقيقة\n📝 **السبب:** \`${reason}\`\n👑 **بواسطة:** ${interaction.user}`)
                        .setFooter({ text: `${interaction.guild.name} • Blacklist System` })
                        .setTimestamp();

                    return interaction.reply({ embeds: [blEmbed] });
                }

                if (sub === 'remove') {
                    const targetUser = interaction.options.getUser('user');
                    await removeUserBlacklist(targetUser.id, guildId);

                    const unblEmbed = new EmbedBuilder()
                        .setColor('#00ff88')
                        .setTitle('✅ تم فك حظر اللاعب من البلاك ليست')
                        .setDescription(`👤 **اللاعب:** ${targetUser} (\`${targetUser.id}\`)\n👑 **تم فك الحظر بواسطة:** ${interaction.user}`)
                        .setFooter({ text: `${interaction.guild.name} • Blacklist System` })
                        .setTimestamp();

                    return interaction.reply({ embeds: [unblEmbed] });
                }

                if (sub === 'list') {
                    const list = await getBlacklistedUsers(guildId);
                    if (!list || list.length === 0) {
                        return interaction.reply({ content: 'ℹ️ **لا يوجد أي لاعبين في قائمة البلاك ليست حالياً.**', ephemeral: true });
                    }

                    const desc = list.map((item, idx) => {
                        return `**#${idx + 1}** <@${item.userId}> (\`${item.userId}\`)\n⏳ **الوقت المتبقي:** \`${formatRemainingTime(item.remainingMs)}\`\n📝 **السبب:** \`${item.reason}\``;
                    }).join('\n\n');

                    const listEmbed = new EmbedBuilder()
                        .setColor('#ff0033')
                        .setTitle('📋 قائمة المحظورين حالياً (Blacklist)')
                        .setDescription(desc)
                        .setFooter({ text: `${interaction.guild.name} • Total Blacklisted: ${list.length}` })
                        .setTimestamp();

                    return interaction.reply({ embeds: [listEmbed] });
                }
            }

            if (commandName === 'unblock') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                    return interaction.reply({ content: '❌ هذا الأمر مخصص للإدارة فقط!', ephemeral: true });
                }
                const targetUser = interaction.options.getUser('user');
                const guildId = interaction.guild.id;

                await removeUserBlacklist(targetUser.id, guildId);

                for (const m of activeMatches.values()) {
                    if (m.guildId === guildId) {
                        m.team1 = m.team1.filter(id => id !== targetUser.id);
                        m.team2 = m.team2.filter(id => id !== targetUser.id);
                        if (m.hostId === targetUser.id || (m.team1.length === 0 && m.team2.length === 0)) {
                            activeMatches.delete(m.id);
                            removeMatchFromDb(m.id);
                        } else {
                            saveMatchToDb(m);
                        }
                    }
                }

                return interaction.reply({ content: `✅ **تم فك التعليق والحظر عن ${targetUser} بنجاح!** يمكنه الآن إنشاء مباريات جديدة أو الانضمام لأي فريق فوراً.` });
            }

            if (commandName === 'clearmatches') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                    return interaction.reply({ content: '❌ هذا الأمر مخصص للإدارة فقط!', ephemeral: true });
                }
                const guildId = interaction.guild.id;
                let count = 0;
                for (const [id, m] of activeMatches.entries()) {
                    if (m.guildId === guildId) {
                        activeMatches.delete(id);
                        removeMatchFromDb(id);
                        count++;
                    }
                }
                return interaction.reply({ content: `🧹 **تم تنظيف جميع المباريات المعلقة (${count}) وفك التعليق عن جميع لاعبي السيرفر بنجاح!**` });
            }
        }

        // --- 2. أزرار الماتش والمودال ---
        if (interaction.isButton()) {
            const { customId } = interaction;

            // فتح نموذج إدخال معلومات الروم
            if (customId.startsWith('enter_room_info_')) {
                const match = findMatchFromInteraction(interaction, 'enter_room_info_');

                if (!match) {
                    return interaction.reply({ content: '❌ هذه المباراة لم تعد متوفرة.', ephemeral: true });
                }

                if (interaction.user.id !== match.hostId) {
                    return interaction.reply({ content: '❌ فقط منشئ المباراة (Host) يمكنه إدخال معلومات الروم!', ephemeral: true });
                }

                const modal = new ModalBuilder()
                    .setCustomId(`modal_room_info_${match.id}`)
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
                const match = findMatchFromInteraction(interaction, isTeam1 ? 'join_team1_' : 'join_team2_');

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
                        .setCustomId(`modal_join_key_${match.id}_${isTeam1 ? '1' : '2'}`)
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
                const match = findMatchFromInteraction(interaction, 'leave_match_');

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
                const match = findMatchFromInteraction(interaction, 'cancel_match_');

                if (!match) {
                    return interaction.reply({ content: '❌ هذه المباراة غير موجودة.', ephemeral: true });
                }

                const isHost = interaction.user.id === match.hostId;
                const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);

                if (!isHost && !isAdmin) {
                    return interaction.reply({ content: '❌ فقط منشئ المباراة أو الإدارة يمكنهم إلغاء المباراة!', ephemeral: true });
                }

                if (match.lobbyTimeout) clearTimeout(match.lobbyTimeout);
                activeMatches.delete(match.id);
                removeMatchFromDb(match.id);

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
                const match = findMatchFromInteraction(interaction, 'copy_room_info_');
                if (!match) {
                    return interaction.reply({ content: '❌ معلومات الروم غير متوفرة حالياً (المباراة غير نشطة).', ephemeral: true });
                }
                const passText = match.password ? match.password : 'No Password';
                return interaction.reply({ 
                    content: `📋 **معلومات الروم:**\n**Room ID:** \`${match.roomId}\`\n**Password:** \`${passText}\``, 
                    ephemeral: true 
                });
            }

            // حذف الروم القديم غير النشط
            if (customId === 'delete_orphan_channel') {
                const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.ManageChannels) || interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);
                if (!isAdmin) {
                    return interaction.reply({ content: '❌ فقط المشرف أو الإدارة يمكنهم حذف الروم!', ephemeral: true });
                }
                await interaction.reply({ content: '🔒 **جاري إغلاق وحذف هذا الروم المؤقت...**' });
                setTimeout(async () => {
                    try { await interaction.channel.delete('Old match channel deleted.'); } catch (e) {}
                }, 2000);
                return;
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
                const match = findMatchFromInteraction(interaction, 'modal_room_info_');

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
                const matchId = match.id;
                match.lobbyTimeout = setTimeout(async () => {
                    const currentMatch = activeMatches.get(matchId);
                    if (currentMatch && currentMatch.state === 'LOBBY') {
                        activeMatches.delete(matchId);
                        removeMatchFromDb(matchId);

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
                const match = findMatchFromInteraction(interaction, 'modal_join_key_');
                const teamNum = customId.endsWith('_2') ? 2 : 1;

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

            // قائمة الإجراءات داخل روم الماتش
            if (customId.startsWith('match_action_select_')) {
                await interaction.deferReply({ ephemeral: true });

                const match = findMatchFromInteraction(interaction, 'match_action_select_');
                const selectedAction = values[0];

                if (!match) {
                    const isMatchChannel = interaction.channel?.name?.toLowerCase().includes('match') || interaction.channel?.isThread?.();
                    const rows = [];
                    if (isMatchChannel) {
                        rows.push(new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId('delete_orphan_channel').setLabel('حذف هذه القناة القديمة').setStyle(ButtonStyle.Danger).setEmoji('🗑️')
                        ));
                    }
                    return interaction.editReply({ 
                        content: '❌ **هذه المباراة غير نشطة** (تم إنشاؤها في جلسة سابقة أو انتهت).\nيمكنك كتابة `!play 1v1` أو `!play 2v2` في شات اللعب لبدء مباراة جديدة وممتعة!', 
                        components: rows
                    });
                }

                const allPlayers = [...match.team1, ...match.team2];
                const isParticipant = allPlayers.includes(interaction.user.id);
                const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);

                // 1. تصويت MVP Winners (المرحلة الأولى من التصويت المتسلسل)
                if (selectedAction === 'mvp_winners') {
                    if (!isParticipant && !isAdmin) {
                        return interaction.editReply({ content: '❌ فقط المشاركون في المباراة أو الإدارة يمكنهم التصويت!' });
                    }

                    match.winnerVotes = new Map();
                    match.loserVotes = new Map();
                    match.winnerVotingConcluded = false;
                    match.votingCompleted = false;

                    const winnerSelect = buildWinnerSelectMenu(match, interaction.guild);

                    await interaction.channel.send({
                        content: `**Mvp winner vote :**\n${allPlayers.map(uid => `<@${uid}>`).join(' ')}`,
                        components: [new ActionRowBuilder().addComponents(winnerSelect)]
                    });

                    return interaction.editReply({ content: '✅ تم فتح تصويت الـ MVP للفريق الفائز بنجاح!' });
                }

                // 2. تصويت MVP Losers
                if (selectedAction === 'mvp_losers') {
                    if (!isParticipant && !isAdmin) {
                        return interaction.editReply({ content: '❌ فقط المشاركون في المباراة أو الإدارة يمكنهم التصويت!' });
                    }

                    if (!match.winningTeam) {
                        return interaction.editReply({ content: '⚠️ يجب التصويت على الفريق الفائز أولاً (MVP Winners) لتحديد الفريق الخاسر!' });
                    }

                    match.loserVotes = new Map();
                    match.votingCompleted = false;
                    const loserSelect = buildLoserSelectMenu(match, interaction.guild);
                    await interaction.channel.send({
                        content: `**Mvp loser vote :**\n${allPlayers.map(uid => `<@${uid}>`).join(' ')}`,
                        components: [new ActionRowBuilder().addComponents(loserSelect)]
                    });

                    return interaction.editReply({ content: '✅ تم فتح تصويت الـ MVP للفريق الخاسر بنجاح!' });
                }

                // 3. طلب مساعدة الإدارة Call Staff
                if (selectedAction === 'call_staff') {
                    const staffRole = interaction.guild.roles.cache.find(r => r.name.toLowerCase().includes('staff') || r.name.toLowerCase().includes('admin'));
                    const staffMention = staffRole ? `<@&${staffRole.id}>` : '@here';
                    await interaction.channel.send({ content: `🚨 **طلب تدخل إداري:** اللاعب ${interaction.user} استدعى طاقم الإدارة! ${staffMention}` });
                    return interaction.editReply({ content: '📞 تم إرسال نداء فوري لطاقم الإدارة.' });
                }

                // 4. إعادة تعيين التصويت Reset MVP Vote
                if (selectedAction === 'reset_mvp') {
                    if (!isAdmin && interaction.user.id !== match.hostId) {
                        return interaction.editReply({ content: '❌ فقط الإدارة أو منشئ المباراة يمكنهم إعادة ضبط التصويت!' });
                    }
                    match.winnerVotes.clear();
                    match.loserVotes.clear();
                    match.winnerVotingConcluded = false;
                    match.votingCompleted = false;
                    saveMatchToDb(match);
                    await interaction.channel.send({ content: `🔄 **تمت إعادة تعيين جميع أصوات المباراة بواسطة ${interaction.user}.**` });
                    return interaction.editReply({ content: '🔄 تم إعادة تعيين أصوات MVP بنجاح.' });
                }

                // 5. إلغاء المباراة من الإدارة Staff Cancel
                if (selectedAction === 'staff_cancel') {
                    if (!isAdmin) {
                        return interaction.editReply({ content: '❌ هذا الإجراء مخصص لطاقم الإدارة فقط!' });
                    }
                    activeMatches.delete(match.id);
                    removeMatchFromDb(match.id);
                    await interaction.channel.send({ content: `🛑 **تم إلغاء المباراة رسمياً وإغلاق الروم بواسطة الإدارة:** ${interaction.user}\n🔒 سيتم إعادة اللاعبين وحذف الغرفة المؤقتة خلال 5 ثوانٍ...` });
                    await returnPlayersToWaiting(interaction.guild, match);
                    await cleanupMatchVoicePermissions(interaction.guild, match);
                    setTimeout(async () => {
                        try { await interaction.channel.delete(); } catch (e) {}
                    }, 5000);
                    return interaction.editReply({ content: '✅ تم إلغاء المباراة وإغلاق الروم.' });
                }

                // 6. الإبلاغ عن خطأ Report Bug
                if (selectedAction === 'report_bug') {
                    return interaction.editReply({ content: '🚨 **للإبلاغ عن خطأ أو مشكلة تقنية:** يرجى فتح تذكرة عبر قسم الدعم الفني أو التواصل مع طاقم الإدارة مباشرة.' });
                }

                // 7. إلغاء المباراة Cancel Match
                if (selectedAction === 'cancel_match_request') {
                    const cancelConfirmRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`confirm_cancel_match_${match.id}`).setLabel('Confirm Cancel').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId(`keep_match_${match.id}`).setLabel('Keep Match').setStyle(ButtonStyle.Secondary)
                    );
                    await interaction.channel.send({
                        content: `⚠️ **طلب إلغاء المباراة:** بدأ ${interaction.user} طلباً لإلغاء المباراة. هل تؤكد الإلغاء؟`,
                        components: [cancelConfirmRow]
                    });
                    return interaction.editReply({ content: '✅ تم إرسال لوحة تأكيد إلغاء المباراة في الشات.' });
                }
            }

            // استقبال صوت الفائز والـ MVP (المرحلة 1)
            if (customId.startsWith('vote_winner_mvp_select_')) {
                const match = findMatchFromInteraction(interaction, 'vote_winner_mvp_select_');
                if (!match) return interaction.reply({ content: '❌ المباراة غير نشطة.', ephemeral: true });

                const voterId = interaction.user.id;
                const allPlayers = [...match.team1, ...match.team2];
                const isParticipant = allPlayers.includes(voterId);
                const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);

                if (!isParticipant && !isAdmin) {
                    return interaction.reply({ content: '❌ فقط المشاركون في المباراة يمكنهم التصويت!', ephemeral: true });
                }

                if (match.winnerVotes.has(voterId)) {
                    return interaction.reply({ content: '❌ You have already voted for MVP winner! Waiting for other voters.', ephemeral: true });
                }

                const candidateId = values[0].replace('win_cand_', '');
                const isT1 = match.team1.includes(candidateId);
                match.winnerVotes.set(voterId, { candidateId, team: isT1 ? 1 : 2 });
                saveMatchToDb(match);

                await interaction.reply({ content: '✅ You have voted for MVP winner!', ephemeral: true });

                // تحديث قائمة التصويت في نفس الرسالة
                try {
                    const updatedSelect = buildWinnerSelectMenu(match, interaction.guild);
                    await interaction.message.edit({
                        components: [new ActionRowBuilder().addComponents(updatedSelect)]
                    });
                } catch (e) {}

                // التحقق من تصويت كلا الفريقين (يجب أن يصوت لاعب من Team 1 ولاعب من Team 2 على الأقل)
                const t1WinnerVoters = allPlayers.filter(uid => match.team1.includes(uid) && match.winnerVotes.has(uid));
                const t2WinnerVoters = allPlayers.filter(uid => match.team2.includes(uid) && match.winnerVotes.has(uid));
                const hasBothTeamsVoted = t1WinnerVoters.length >= 1 && t2WinnerVoters.length >= 1;
                const totalVoted = match.winnerVotes.size;

                // إذا لم يصوت كلا الفريقين بعد، ننتظر تصويت الفريق الآخر
                if (!hasBothTeamsVoted && totalVoted < allPlayers.length) {
                    return;
                }

                // تحديد اللاعب الأكثر أصواتاً وفحص التعادل بين الفريقين
                const candidateCounts = {};
                for (const v of match.winnerVotes.values()) {
                    candidateCounts[v.candidateId] = (candidateCounts[v.candidateId] || 0) + 1;
                }
                let topCandidate = candidateId;
                let maxVotes = 0;
                let isTie = false;
                for (const [cId, count] of Object.entries(candidateCounts)) {
                    if (count > maxVotes) {
                        maxVotes = count;
                        topCandidate = cId;
                        isTie = false;
                    } else if (count === maxVotes) {
                        isTie = true;
                    }
                }

                // إذا كان هناك تعادل أو اختلاف بين الفريقين (Vote Mismatch) ولم يصوت جميع اللاعبين بعد
                if (isTie && totalVoted < allPlayers.length) {
                    await interaction.channel.send({
                        content: `⚠️ **Vote Mismatch!** The voters selected different players for MVP Winners. Remaining players in both teams please vote to decide the winner!`
                    });
                    return;
                }

                if (match.winnerVotingConcluded) return;
                match.winnerVotingConcluded = true;

                match.winningMvpUid = topCandidate;
                match.winningTeam = match.team1.includes(topCandidate) ? 1 : 2;
                saveMatchToDb(match);

                const votersMentions = Array.from(match.winnerVotes.keys()).map(id => `<@${id}>`).join(', ');

                const winnerSelectedEmbed = new EmbedBuilder()
                    .setColor('#2b2d31')
                    .setTitle('👾 MVP Winners Selected!')
                    .setDescription(
                        `Winner: <@${match.winningMvpUid}>\n\n` +
                        `+80 MVP point(s) will be awarded after both MVPs are selected.\n\n` +
                        `📊 Total Votes: ${totalVoted}/${match.teamSize * 2}\n` +
                        `✅ Voters: ${votersMentions}`
                    );

                await interaction.channel.send({ embeds: [winnerSelectedEmbed] });
                await interaction.channel.send({
                    content: `👾 **MVP Winners Selected!**\n\n<@${match.winningMvpUid}> has been voted as MVP Winners.\n👉 Please choose **MVP Losers** from the Select Action menu above to start the losing team vote.`
                });
                saveMatchToDb(match);
                return;
            }

            // استقبال صوت MVP الخاسر (المرحلة 2)
            if (customId.startsWith('vote_loser_mvp_select_')) {
                const match = findMatchFromInteraction(interaction, 'vote_loser_mvp_select_');
                if (!match) return interaction.reply({ content: '❌ المباراة غير نشطة.', ephemeral: true });

                const voterId = interaction.user.id;
                const allPlayers = [...match.team1, ...match.team2];
                const isParticipant = allPlayers.includes(voterId);
                const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);

                if (!isParticipant && !isAdmin) {
                    return interaction.reply({ content: '❌ فقط المشاركون في المباراة يمكنهم التصويت!', ephemeral: true });
                }

                if (match.loserVotes.has(voterId)) {
                    return interaction.reply({ content: '❌ You have already voted for MVP loser! Waiting for other voters.', ephemeral: true });
                }

                const candidateId = values[0].replace('loser_cand_', '');
                match.loserVotes.set(voterId, candidateId);
                saveMatchToDb(match);

                await interaction.reply({ content: '✅ You have voted for MVP loser!', ephemeral: true });

                // تحديث قائمة التصويت في نفس الرسالة
                try {
                    const updatedSelect = buildLoserSelectMenu(match, interaction.guild);
                    await interaction.message.edit({
                        components: [new ActionRowBuilder().addComponents(updatedSelect)]
                    });
                } catch (e) {}

                // التحقق من تصويت كلا الفريقين على الخاسر
                const t1LoserVoters = allPlayers.filter(uid => match.team1.includes(uid) && match.loserVotes.has(uid));
                const t2LoserVoters = allPlayers.filter(uid => match.team2.includes(uid) && match.loserVotes.has(uid));
                const hasBothTeamsLoserVoted = t1LoserVoters.length >= 1 && t2LoserVoters.length >= 1;
                const totalVoted = match.loserVotes.size;

                if (!hasBothTeamsLoserVoted && totalVoted < allPlayers.length) {
                    return;
                }

                const loserCounts = {};
                for (const candId of match.loserVotes.values()) {
                    loserCounts[candId] = (loserCounts[candId] || 0) + 1;
                }
                let topLoser = candidateId;
                let maxLoserVotes = 0;
                let isTieLoser = false;
                for (const [cId, count] of Object.entries(loserCounts)) {
                    if (count > maxLoserVotes) {
                        maxLoserVotes = count;
                        topLoser = cId;
                        isTieLoser = false;
                    } else if (count === maxLoserVotes) {
                        isTieLoser = true;
                    }
                }

                if (isTieLoser && totalVoted < allPlayers.length) {
                    await interaction.channel.send({
                        content: `⚠️ **Vote Mismatch!** The voters selected different players for MVP Losers. Remaining players please vote to decide!`
                    });
                    return;
                }

                if (match.votingCompleted) return;
                match.votingCompleted = true;

                match.losingMvpUid = topLoser;
                saveMatchToDb(match);

                const loserVotersMentions = Array.from(match.loserVotes.keys()).map(id => `<@${id}>`).join(', ');

                const loserSelectedEmbed = new EmbedBuilder()
                    .setColor('#2b2d31')
                    .setTitle('🔴 MVP Losers Selected!')
                    .setDescription(
                        `Winner: <@${match.losingMvpUid}>\n\n` +
                        `+30 MVP point(s) will be awarded after both MVPs are selected.\n\n` +
                        `📊 Total Votes: ${totalVoted}/${match.teamSize * 2}\n` +
                        `✅ Voters: ${loserVotersMentions}`
                    );

                await interaction.channel.send({ embeds: [loserSelectedEmbed] });
                await interaction.channel.send({
                    content: `🔴 **MVP Losers Selected!**\n\n<@${match.losingMvpUid}> has been voted as MVP Losers.\nMVP points will be awarded after **both** MVPs are selected.`
                });

                // إنهاء الماتش وتوزيع النقاط عبر دالة finalizeMatch
                await finalizeMatch(interaction.guild, match, interaction.channel);
                return;
            }

            // تأكيد إلغاء المباراة
            if (customId.startsWith('confirm_cancel_match_')) {
                const match = findMatchFromInteraction(interaction, 'confirm_cancel_match_');
                if (!match) return interaction.reply({ content: '❌ المباراة غير نشطة.', ephemeral: true });

                activeMatches.delete(match.id);
                removeMatchFromDb(match.id);

                await interaction.reply({ content: `🛑 **تم إلغاء المباراة رسمياً بناءً على طلب اللاعبين.**\n🔒 سيتم إعادة الجميع وحذف الروم خلال 5 ثوانٍ...` });
                await returnPlayersToWaiting(interaction.guild, match);
                await cleanupMatchVoicePermissions(interaction.guild, match);
                setTimeout(async () => {
                    try { await interaction.channel.delete(); } catch (e) {}
                }, 5000);
                return;
            }

            if (customId.startsWith('keep_match_')) {
                return interaction.reply({ content: '✅ تم التراجع عن الإلغاء والاستمرار في المباراة.', ephemeral: true });
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

// دالة بناء قائمة تصويت الفائز (CHOSE THE MVP - Stage 1)
function buildWinnerSelectMenu(match, guild) {
    const counts = {};
    for (const v of match.winnerVotes.values()) {
        counts[v.candidateId] = (counts[v.candidateId] || 0) + 1;
    }

    const t1Opts = match.team1.map(uid => {
        const m = guild.members.cache.get(uid);
        const name = m ? m.displayName : uid;
        const vCount = counts[uid] || 0;
        return {
            label: `${name} (${vCount} votes)`,
            description: 'Team 1',
            value: `win_cand_${uid}`,
            emoji: '🔴'
        };
    });

    const t2Opts = match.team2.map(uid => {
        const m = guild.members.cache.get(uid);
        const name = m ? m.displayName : uid;
        const vCount = counts[uid] || 0;
        return {
            label: `${name} (${vCount} votes)`,
            description: 'Team 2',
            value: `win_cand_${uid}`,
            emoji: '🟢'
        };
    });

    return new StringSelectMenuBuilder()
        .setCustomId(`vote_winner_mvp_select_${match.id}`)
        .setPlaceholder('CHOSE THE MVP')
        .addOptions([...t1Opts, ...t2Opts]);
}

// دالة بناء قائمة تصويت الخاسر (CHOSE THE MVP - Stage 2)
function buildLoserSelectMenu(match, guild) {
    const losingPlayers = match.winningTeam === 1 ? match.team2 : match.team1;
    const losingTeamLabel = match.winningTeam === 1 ? 'Team 2' : 'Team 1';
    const losingEmoji = match.winningTeam === 1 ? '🟢' : '🔴';

    const counts = {};
    for (const candId of match.loserVotes.values()) {
        counts[candId] = (counts[candId] || 0) + 1;
    }

    const opts = losingPlayers.map(uid => {
        const m = guild.members.cache.get(uid);
        const name = m ? m.displayName : uid;
        const vCount = counts[uid] || 0;
        return {
            label: `${name} (${vCount} votes)`,
            description: losingTeamLabel,
            value: `loser_cand_${uid}`,
            emoji: losingEmoji
        };
    });

    return new StringSelectMenuBuilder()
        .setCustomId(`vote_loser_mvp_select_${match.id}`)
        .setPlaceholder('CHOSE THE MVP')
        .addOptions(opts);
}

// معالجة الانضمام للفرق
async function handleTeamJoin(interaction, match, teamNum) {
    const uid = interaction.user.id;
    const guildId = interaction.guild.id;

    // 1. التحقق من البلاك ليست
    const bl = await isUserBlacklisted(uid, guildId);
    if (bl.blacklisted) {
        return interaction.reply({ 
            content: `⛔ **أنت في قائمة الحظر (Blacklist)!**\n⏳ **متبقي على فك الحظر:** \`${formatRemainingTime(bl.remainingMs)}\`\n📝 **السبب:** \`${bl.reason}\``, 
            ephemeral: true 
        });
    }

    // 2. التحقق من التواجد في مباراة أخرى نشطة لم يكتمل تصويتها بعد (مع تنظيف الرومات المحذوفة تلقائياً)
    const activeMatchForUser = getRealActiveMatchForUser(interaction.guild, uid, match.id);
    if (activeMatchForUser) {
        const chId = activeMatchForUser.matchChannelId || activeMatchForUser.threadId;
        return interaction.reply({ 
            content: `❌ **لا يمكنك الانضمام لمباراة أخرى!**\nأنت متواجد بالفعل في مباراة نشطة (<#${chId}>) حتى ينتهي التصويت بالكامل.`, 
            ephemeral: true 
        });
    }

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
    saveMatchToDb(match);

    await interaction.reply({ content: `✅ تم انضمامك إلى **Team ${teamNum}** بنجاح!`, ephemeral: true });
    await updateLobbyMessage(interaction.guild, match);

    // التحقق من اكتمال الفريقين وبدء المباراة فوراً
    if (match.team1.length === match.teamSize && match.team2.length === match.teamSize) {
        if (match.lobbyTimeout) clearTimeout(match.lobbyTimeout);
        match.state = 'IN_PROGRESS';
        saveMatchToDb(match);
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

        const readyMsg = await playChannel.send({ embeds: [readyEmbed] });

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

        // منح صلاحيات الفويس للاعبي Team 1 و Team 2 لتبقى مفتوحة لهم طوال الماتش حتى لو خرجوا
        if (selectedT1Voice) {
            for (const uid of match.team1) {
                await selectedT1Voice.permissionOverwrites.edit(uid, {
                    Connect: true,
                    ViewChannel: true,
                    Speak: true
                }).catch(() => {});
            }
        }

        if (selectedT2Voice) {
            for (const uid of match.team2) {
                await selectedT2Voice.permissionOverwrites.edit(uid, {
                    Connect: true,
                    ViewChannel: true,
                    Speak: true
                }).catch(() => {});
            }
        }

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

        // 3. إنشاء قناة نصية خاصة مؤقتة للمباراة مع إعطاء صلاحيات كاملة لكل لاعب في Team 1 و Team 2
        const permissionOverwrites = [
            {
                id: guild.id, // @everyone
                deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
            },
            {
                id: client.user.id, // البوت
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ManageChannels,
                    PermissionFlagsBits.EmbedLinks,
                    PermissionFlagsBits.AttachFiles,
                    PermissionFlagsBits.ReadMessageHistory
                ]
            }
        ];

        // منح كل لاعب في الفريقين صلاحية الرؤية والكتابة الكاملة حتى لو لم يكن لديه أي رتبة في السيرفر
        for (const uid of allParticipants) {
            permissionOverwrites.push({
                id: uid,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.AttachFiles,
                    PermissionFlagsBits.EmbedLinks,
                    PermissionFlagsBits.AddReactions
                ]
            });
        }

        // منح الإدارة صلاحية المراقبة
        const staffRoles = guild.roles.cache.filter(r => 
            r.permissions.has(PermissionFlagsBits.Administrator) || 
            r.permissions.has(PermissionFlagsBits.ManageGuild) ||
            r.name.toLowerCase().includes('staff') ||
            r.name.toLowerCase().includes('admin')
        );
        for (const role of staffRoles.values()) {
            permissionOverwrites.push({
                id: role.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.ManageMessages
                ]
            });
        }

        // البحث عن روم مخصص لإنشاء الثريدات مثل paradisss أو partidasss
        const paradisChannel = guild.channels.cache.find(c => 
            c.type === ChannelType.GuildText && 
            (c.name.toLowerCase().includes('paradis') || c.name.toLowerCase().includes('partida'))
        );
        const threadParentChannel = paradisChannel || playChannel;

        let matchChannel;
        try {
            matchChannel = await threadParentChannel.threads.create({
                name: `Match ${match.id}`,
                autoArchiveDuration: 60,
                type: ChannelType.PrivateThread, // Fil privé
                invitable: false,
                reason: `Private thread for Free Fire Match ${match.id}`
            });
        } catch (threadErr) {
            console.error('Failed to create private thread, creating public thread fallback:', threadErr);
            matchChannel = await threadParentChannel.threads.create({
                name: `Match ${match.id}`,
                autoArchiveDuration: 60,
                reason: `Thread for Free Fire Match ${match.id}`
            });
        }

        // إضافة جميع اللاعبين في الفريقين (Team 1 & Team 2) داخل الـ Fil Privé
        for (const uid of allParticipants) {
            await matchChannel.members.add(uid).catch(e => console.error(`Error adding ${uid} to match thread:`, e));
        }

        match.matchChannelId = matchChannel.id;
        match.threadId = matchChannel.id;
        saveMatchToDb(match);

        // تحديث رسالة Match Ready بالرابط المباشر للروم
        const readyUpdatedEmbed = new EmbedBuilder()
            .setColor('#2f3136')
            .setTitle('✔ Match Ready!')
            .setDescription(`🎮 **Match Room:** <#${matchChannel.id}>\n🔊 Players moved to voice channels.`)
            .setFooter({ text: new Date().toLocaleString() });
        await readyMsg.edit({ embeds: [readyUpdatedEmbed] }).catch(() => {});

        // 4. تجميع المنشن (Owners, Staff, Participants)
        const owners = guild.members.cache.filter(m => m.id === guild.ownerId).map(m => `<@${m.id}>`).join(' ') || `<@${guild.ownerId}>`;
        const staffMembers = guild.members.cache.filter(m => m.permissions.has(PermissionFlagsBits.ManageGuild) && !m.user.bot).map(m => `<@${m.id}>`).slice(0, 15).join(' ') || 'None';
        const participantMentions = allParticipants.map(uid => `<@${uid}>`).join(' ');

        await matchChannel.send({
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

        await matchChannel.send({ embeds: [matchStartedEmbed], components: [voiceButtonsRow] });

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
                    description: 'Staff only — cancel match immediately',
                    value: 'staff_cancel',
                    emoji: '🛑'
                },
                {
                    label: 'Report Bug',
                    description: 'Report a bug with risk and details',
                    value: 'report_bug',
                    emoji: '🚨'
                },
                {
                    label: 'Cancel Match',
                    description: 'Any player can start — confirm on the cancel panel',
                    value: 'cancel_match_request',
                    emoji: '✖'
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

        await matchChannel.send({
            content: '🪵 **Use the menu below to vote or report problems**',
            embeds: [roomInfoEmbed],
            components: [menuRow, copyInfoRow]
        });

    } catch (err) {
        console.error('Error starting match:', err);
    }
}

client.login(process.env.DISCORD_TOKEN);