
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('OVER M9AWDIN Bot is alive and running 24/7!');
});

app.listen(port, () => {
    console.log(`Web server is listening on port ${port}`);
});


const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
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

// الاتصال بقاعدة البيانات
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) console.error('Error opening database', err.message);
    else console.log('Connected to SQLite database successfully.');
});

// إنشاء الجدول إذا لم يكن موجوداً
db.run(`CREATE TABLE IF NOT EXISTS users (
    userId TEXT,
    guildId TEXT,
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    messages INTEGER DEFAULT 0,
    voiceTime INTEGER DEFAULT 0,
    PRIMARY KEY (userId, guildId)
)`);

client.once('clientReady', async () => {
    console.log(`Logged in as ${client.user.tag} (Node.js Supercharged Mode)`);

    const commands = [
        new SlashCommandBuilder()
            .setName('profile')
            .setDescription('عرض بروفايل العضو الإحصائي')
            .addUserOption(option => option.setName('user').setDescription('اختر عضواً').setRequired(false)),
        new SlashCommandBuilder()
            .setName('rank')
            .setDescription('عرض مستوى وريتبة العضو')
            .addUserOption(option => option.setName('user').setDescription('اختر عضواً').setRequired(false)),
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
            .addRoleOption(option => option.setName('role').setDescription('الرتبة المراد سحبها').setRequired(true))
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Slash commands registered successfully.');
    } catch (error) {
        console.error(error);
    }
});

// نظام الـ XP والرسائل
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    const userId = message.author.id;
    const guildId = message.guild.id;

    db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [userId, guildId], (err, row) => {
        if (!row) {
            db.run(`INSERT INTO users (userId, guildId, xp, level, messages) VALUES (?, ?, 15, 1, 1)`, [userId, guildId]);
        } else {
            const newXp = row.xp + 15;
            const newMessages = row.messages + 1;
            let newLevel = row.level;

            if (newXp >= row.level * 100) {
                newLevel += 1;
            }

            db.run(`UPDATE users SET xp = ?, level = ?, messages = ? WHERE userId = ? AND guildId = ?`, [newXp, newLevel, newMessages, userId, guildId]);
        }
    });
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    // 1. أمر البروفايل الفوري
    if (commandName === 'profile') {
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

        db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [targetUser.id, interaction.guild.id], async (err, row) => {
            const level = row ? row.level : 1;
            const xp = row ? row.xp : 0;
            const messages = row ? row.messages : 0;
            const voiceTime = row ? row.voiceTime || 0 : 0;

            const minutes = Math.floor(voiceTime / 60);
            const seconds = voiceTime % 60;
            const voiceFormatted = `${minutes}m ${seconds}s`;

            const joinedDate = member && member.joinedAt ? member.joinedAt.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : 'غير معروف';

            const roles = member ? member.roles.cache
                .filter(r => r.id !== interaction.guild.id)
                .map(r => `<@&${r.id}>`)
                .join(' , ') || 'لا توجد رتب' : 'لا توجد رتب';

            const embed = new EmbedBuilder()
                .setColor(0x2f3136)
                .setTitle(`📊 Profile — ${targetUser.username}`)
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 512 }))
                .addFields(
                    { name: '⭐ Level', value: `${level}`, inline: true },
                    { name: '✨ XP', value: `${xp}`, inline: true },
                    { name: '🏆 Rank', value: `#1`, inline: true },
                    { name: '💬 Messages', value: `${messages}`, inline: true },
                    { name: '🎙️ Voice Time', value: `${voiceFormatted}`, inline: true },
                    { name: '📅 Joined Server', value: `${joinedDate}`, inline: false },
                    { name: '🎭 Roles', value: roles, inline: false }
                )
                .setFooter({ text: `OVER M9AWDIN • Management System`, iconURL: interaction.guild.iconURL() })
                .setTimestamp();

            await interaction.reply({ embeds: [embed] }).catch(() => { });
        });
    }

    // 2. أمر الرانك الفوري
    if (commandName === 'rank') {
        const targetUser = interaction.options.getUser('user') || interaction.user;

        db.get(`SELECT * FROM users WHERE userId = ? AND guildId = ?`, [targetUser.id, interaction.guild.id], async (err, row) => {
            const level = row ? row.level : 1;
            const xp = row ? row.xp : 0;
            const requiredXp = level * 100;

            const embed = new EmbedBuilder()
                .setColor(0x2f3136)
                .setTitle(`🏆 Rank Stats — ${targetUser.username}`)
                .setDescription(`إليك إحصائيات المستوى والـ XP يا أسطى!`)
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 512 }))
                .addFields(
                    { name: '⭐ Level', value: `${level}`, inline: true },
                    { name: '✨ XP', value: `${xp}`, inline: true },
                    { name: '📊 Server Rank', value: `#1`, inline: true },
                    { name: '📈 Next Level', value: `${xp} / ${requiredXp} XP`, inline: false }
                )
                .setFooter({ text: `OVER M9AWDIN • Management System`, iconURL: interaction.guild.iconURL() })
                .setTimestamp();

            await interaction.reply({ embeds: [embed] }).catch(() => { });
        });
    }

    // 3. أمر القوانين بالتصميم النصي العصري المطابق لصورة التحديثات
    if (commandName === 'rules') {
        const rulesText = `
╭━━━ 🛡️ **[ OVER M9AWDIN - SERVER RULES ]** 🛡️ ━━━╮

✨ **أهلاً بك يا بطل في مجتمعنا الرسمي!** ✨
لضمان بيئة آمنة، ممتعة، ومنظمة للجميع، نرجو الالتزام بالقوانين التالية:

### ⚙️ **قوانين السيرفر الأساسية (General Rules):**
> 🔹 **الاحترام المتبادل / Respect**
> * 📌 **العربي:** يمنع منعاً باتاً الشتم، السب، أو إهانة أي عضو بأي شكل كان.
> * 📌 **English:** No hate speech, harassment, or disrespect towards any member.
> 
> 🔹 **المنشورات والإعلانات / Advertising**
> * 📌 **العربي:** يمنع نشر روابط سيرفرات أخرى أو الإعلانات التجارية بدون إذن الإدارة.
> * 📌 **English:** Self-promotion or advertising other servers is strictly prohibited.
> 
> 🔹 **السبام والاسام / Spam & Flood**
> * 📌 **العربي:** يمنع إرسال الرسائل المتكررة، الصور المزعجة (Spam)، أو استخدام الصوت بشكل مزعج في الرومات.
> * 📌 **English:** Avoid spamming chat channels, flashing images, or mic-spamming in voice rooms.

---

### 🔥 **التعاون والتواصل (Support & Collab)**
* 💬 **الالتزام بالقنوات المخصصة:** ضع كل موضوع في مكانه الصحيح (السوالف، الدعم، الأوامر).
* 🎙️ **احترام الرومات الصوتية:** عدم إزعاج الأعضاء الآخرين في الغرف الصوتية.
* 🏆 **النتيجة:** مخالفتك لهذه القوانين قد تعرضك للعقوبات (تحذير، ميوت، أو كيك).

🚀 **معاً نبني أفخم وأقوى مجتمع! التزم بالقوانين واستمتع بوقتك.**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 **OVER M9AWDIN • Management System**
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
        `;

        await interaction.reply({ content: rulesText }).catch(() => { });
    }

    // 4. أمر إعطاء الرتبة
    if (commandName === 'giverole') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return interaction.reply({ content: '❌ ليس لديك صلاحية لإدارة الرتب!', ephemeral: true });
        }
        const member = interaction.options.getMember('member');
        const role = interaction.options.getRole('role');

        await member.roles.add(role).catch(() => { });

        const embed = new EmbedBuilder()
            .setColor(0x2f3136)
            .setTitle(`⚡ ROLE ASSIGNED SUCCESSFULLY ⚡`)
            .setDescription(`تم إعطاء الرتبة بنجاح وعليها ختم الجودة يا أسطى!`)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 512 }))
            .addFields(
                { name: '👤 Target Member', value: `<@${member.id}> (${member.user.username})`, inline: false },
                { name: '🛡️ Granted Role', value: `<@&${role.id}>`, inline: true },
                { name: '👑 Managed By', value: `<@${interaction.user.id}>`, inline: true }
            )
            .setFooter({ text: `OVER M9AWDIN • Management System`, iconURL: interaction.guild.iconURL() })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] }).catch(() => { });
    }

    // 5. أمر سحب الرتبة
    if (commandName === 'removerole') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return interaction.reply({ content: '❌ ليس لديك صلاحية لإدارة الرتب!', ephemeral: true });
        }
        const member = interaction.options.getMember('member');
        const role = interaction.options.getRole('role');

        await member.roles.remove(role).catch(() => { });

        const embed = new EmbedBuilder()
            .setColor(0x2f3136)
            .setTitle(`⚠️ ROLE REMOVED SUCCESSFULLY ⚠️`)
            .setDescription(`تم سحب الرتبة بنجاح يا أسطى!`)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 512 }))
            .addFields(
                { name: '👤 Target Member', value: `<@${member.id}> (${member.user.username})`, inline: false },
                { name: '🛡️ Removed Role', value: `<@&${role.id}>`, inline: true },
                { name: '👑 Managed By', value: `<@${interaction.user.id}>`, inline: true }
            )
            .setFooter({ text: `OVER M9AWDIN • Management System`, iconURL: interaction.guild.iconURL() })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] }).catch(() => { });
    }
});
// تفاعل أوامر وإزرار البوت
client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        // 1. أمر إرسال لوحة التذاكر
        if (commandName === 'ticket') {
            if (!interaction.member.permissions.has('Administrator')) {
                return interaction.reply({ content: '❌ ليس لديك صلاحية لاستخدام هذا الأمر!', ephemeral: true });
            }

            const targetChannel = interaction.options.getChannel('channel');

            const ticketEmbed = new EmbedBuilder()
                .setColor('#2b2d31')
                .setTitle('📁 ── ❲ نظام التذاكر والدعم ❲ ──')
                .setDescription('اختر القسم المناسب أدناه لفتح تذكرة خاصة مع فريق الإدارة.\n\n> ⚠️ **تنبيه:** يرجى عدم فتح أكثر من تذكرة في نفس الوقت لتجنب العقوبة.')
                .addFields(
                    { name: '🛡️ Help', value: 'افتح هذه التذكرة إذا كنت تحتاج إلى مساعدة عامة داخل السيرفر.', inline: false },
                    { name: '⚔️ Server Abuse', value: 'افتح هذه التذكرة حصراً للإبلاغ عن أي إساءة أو تجاوز ضدك.', inline: false }
                )
                .setFooter({ text: 'OVER M9AWDIN • Support System', iconURL: client.user.displayAvatarURL() })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('create_ticket_help')
                    .setLabel('Help')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🛡️'),
                new ButtonBuilder()
                    .setCustomId('create_ticket_abuse')
                    .setLabel('Server Abuse')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('⚔️')
            );

            await targetChannel.send({ embeds: [ticketEmbed], components: [row] });
            await interaction.reply({ content: `✅ تم إرسال لوحة التذاكر بنجاح إلى القناة ${targetChannel}`, ephemeral: true });
        }
    }

    // 2. عندما يضغط العضو على زر فتح التذكرة
    else if (interaction.isButton() && (interaction.customId === 'create_ticket_help' || interaction.customId === 'create_ticket_abuse')) {
        await interaction.deferReply({ ephemeral: true });

        const ticketType = interaction.customId === 'create_ticket_help' ? 'Help' : 'Server Abuse';
        const channelName = `ticket-${interaction.user.username.toLowerCase()}`;

        const existingChannel = interaction.guild.channels.cache.find(c => c.name === channelName);
        if (existingChannel) {
            return interaction.editReply({ content: `❌ لديك تذكرة مفتوحة بالفعل هنا: ${existingChannel}` });
        }

        try {
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
                .setDescription(`مرحباً بك ${interaction.user}، شكراً لفتح التذكرة.\nسيقوم أحد أعضاء فريق الإدارة بمساعدتك قريباً.`)
                .addFields(
                    { name: '📂 القسم', value: ticketType, inline: true },
                    { name: '🆔 رقم التذكرة', value: `TTE-${Math.random().toString(36).substring(2, 9).toUpperCase()}`, inline: true }
                )
                .setFooter({ text: 'OVER M9AWDIN • Support System', iconURL: client.user.displayAvatarURL() })
                .setTimestamp();

            const ticketControlRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('Close Ticket')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔒')
            );

            await ticketChannel.send({
                content: `${interaction.user} أهلاً بك!`,
                embeds: [welcomeEmbed],
                components: [ticketControlRow]
            });

            await interaction.editReply({ content: `✅ تم إنشاء تذكرتك بنجاح في القناة: ${ticketChannel}` });

        } catch (error) {
            console.error(error);
            await interaction.editReply({ content: '❌ حدث خطأ أثناء إنشاء التذكرة، تأكد من صلاحيات البوت.' });
        }
    }

    // 3. عندما يضغط المشرف على زر إغلاق التذكرة
    else if (interaction.isButton() && interaction.customId === 'close_ticket') {
        if (!interaction.member.permissions.has('ManageChannels')) {
            return interaction.reply({ content: '❌ فقط الإدارة يمكنها إغلاق التذكرة!', ephemeral: true });
        }

        await interaction.reply({ content: '🔒 جاري إغلاق وحذف هذه التذكرة خلال 5 ثوانٍ...' });
        setTimeout(async () => {
            try {
                await interaction.channel.delete();
            } catch (err) {
                console.error('Error deleting channel:', err);
            }
        }, 5000);
    }
});
client.login(process.env.DISCORD_TOKEN);