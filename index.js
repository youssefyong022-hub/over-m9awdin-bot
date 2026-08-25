const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('DEBBABI CHEAT Bot is alive and running 24/7!');
});

app.listen(port, () => {
    console.log(`Web server is listening on port ${port}`);
});

const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, UserSelectMenuBuilder, StringSelectMenuBuilder } = require('discord.js');
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
    console.log(`Logged in as ${client.user.tag} (Elite Exact Design Mode)`);

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
            .setDescription('إرسال لوحة فحص اللاعبين الأسطورية')
            .addChannelOption(option =>
                option.setName('channel')
                    .setDescription('القناة التي ستُرسل فيها لوحة الفحص')
                    .setRequired(true)
            )
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Slash commands registered successfully.');
    } catch (error) {
        console.error(error);
    }
});

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

            if (newXp >= row.level * 100) newLevel += 1;

            db.run(`UPDATE users SET xp = ?, level = ?, messages = ? WHERE userId = ? AND guildId = ?`, [newXp, newLevel, newMessages, userId, guildId]);
        }
    });
});

const activeCheckSessions = new Map();

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

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
                    .setFooter({ text: `DEBBABI CHEAT • Management System`, iconURL: interaction.guild.iconURL() })
                    .setTimestamp();

                await interaction.reply({ embeds: [embed] }).catch(() => { });
            });
        }

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
                    .setFooter({ text: `DEBBABI CHEAT • Management System`, iconURL: interaction.guild.iconURL() })
                    .setTimestamp();

                await interaction.reply({ embeds: [embed] }).catch(() => { });
            });
        }

        if (commandName === 'rules') {
            const rulesText = `
╭━━━ 🛡️ **[ DEBBABI CHEAT - SERVER RULES ]** 🛡️ ━━━╮
✨ **أهلاً بك يا بطل في مجتمعنا الرسمي!** لضمان بيئة آمنة ومنظمة للجميع.
> 🔹 **الاحترام المتبادل:** يمنع الشتم والسب منعاً باتاً.
> 🔹 **الإعلانات والسبام:** يمنع نشر الروابط أو السبام نهائياً.
📌 **DEBBABI CHEAT • Management System**
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
            `;
            await interaction.reply({ content: rulesText }).catch(() => { });
        }

        if (commandName === 'ticket') {
            if (!interaction.member.permissions.has('Administrator')) {
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
            await interaction.reply({ content: `✅ تم إرسال لوحة التذاكر بنجاح إلى القناة ${targetChannel}`, ephemeral: true });
        }

        // أمر لوحة الفحص المطابق تماماً للصورة الأسطورية مع البانر والإحصائيات
        if (commandName === 'checker') {
            if (!interaction.member.permissions.has('Administrator')) {
                return interaction.reply({ content: '❌ ليس لديك صلاحية لاستخدام هذا الأمر!', ephemeral: true });
            }

            const targetChannel = interaction.options.getChannel('channel');

            const eliteCheckerEmbed = new EmbedBuilder()
                .setColor('#2f3136')
                .setTitle(':profettionel_checker: Player Check System')
                .setDescription('Report suspicious players for verification\n\n🚨 **How it works:**\n• Click **Check a user** → @tag a **server member** (must be in this server) :searchLyrics:\n• Choose if they play on **Phone** or **PC**\n• Pay **50 points** to request a check\n• If the player is a **cheater** → Your **50 points** are recovered and you get **+20 points** 🤌\n• If the player is **clean** → You lose **30 points** :03_reaper_p4radise: (check cost is not recovered)\n• If player is **already verified** → No charge.\n\n**If you catch 5 cheaters in a row you will be rewarded** @Cheater Hunter\nA clean result resets your streak — you must get 5 consecutive cheaters.\n\nThink carefully before reporting!\n**Stats:**\n> Pending: `1` | Cheaters Found: `7` | Clean: `5`')
                .setImage('https://i.imgur.com/2Z091Wl.png')
                .setFooter({ text: 'DEBBABI CHEAT • Anti-Cheat Division', iconURL: client.user.displayAvatarURL() })
                .setTimestamp();

            const eliteCheckerRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('open_checker_interactive')
                    .setLabel('Check a user')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🔍'),
                new ButtonBuilder()
                    .setCustomId('view_my_reports')
                    .setLabel('See my reports')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('📋')
            );

            await targetChannel.send({ embeds: [eliteCheckerEmbed], components: [eliteCheckerRow] });
            await interaction.reply({ content: `✅ تم إرسال لوحة الفحص الأسطورية بنجاح إلى القناة ${targetChannel}`, ephemeral: true });
        }
    }

    else if (interaction.isButton()) {
        if (interaction.customId === 'create_ticket_help' || interaction.customId === 'create_ticket_abuse') {
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
                    .setDescription(`مرحباً بك ${interaction.user}، سيقوم أحد أعضاء فريق الإدارة بمساعدتك قريباً.`);

                const ticketControlRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒')
                );

                await ticketChannel.send({ content: `${interaction.user} أهلاً بك!`, embeds: [welcomeEmbed], components: [ticketControlRow] });
                await interaction.editReply({ content: `✅ تم إنشاء تذكرتك بنجاح في القناة: ${ticketChannel}` });

            } catch (error) {
                console.error(error);
                await interaction.editReply({ content: '❌ حدث خطأ أثناء إنشاء التذكرة.' });
            }
        }

        else if (interaction.customId === 'close_ticket') {
            if (!interaction.member.permissions.has('ManageChannels')) {
                return interaction.reply({ content: '❌ فقط الإدارة يمكنها إغلاق التذكرة!', ephemeral: true });
            }

            await interaction.reply({ content: '🔒 جاري إغلاق وحذف هذه التذكرة خلال 5 ثوانٍ...' });
            setTimeout(async () => {
                try { await interaction.channel.delete(); } catch (err) { }
            }, 5000);
        }

        // تفاعل زر Check a user لعرض القوائم المنسدلة العصرية المطابقة للصورة تماماً
        else if (interaction.customId === 'open_checker_interactive') {
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

            const row1 = new ActionRowBuilder().addComponents(userSelect);
            const row2 = new ActionRowBuilder().addComponents(platformSelect);
            const row3 = new ActionRowBuilder().addComponents(submitButton);

            await interaction.reply({
                embeds: [panelEmbed],
                components: [row1, row2, row3],
                ephemeral: true
            });
        }

        else if (interaction.customId === 'view_my_reports') {
            await interaction.reply({
                content: `📋 **سجل تقاريرك:** ليس لديك أي بلاغات سابقة حتى الآن يا بطل.`,
                ephemeral: true
            });
        }

        else if (interaction.customId === 'submit_final_check') {
            const session = activeCheckSessions.get(interaction.user.id);

            if (!session || !session.suspectId || !session.platform) {
                return interaction.reply({ content: '❌ يجب عليك اختيار اللاعب أولاً وتحديد المنصة (PC أو Phone)!', ephemeral: true });
            }

            const reporter = interaction.user;
            const suspectMember = await interaction.guild.members.fetch(session.suspectId).catch(() => null);
            const suspectName = suspectMember ? `<@${suspectMember.id}>` : 'Unknown User';

            await interaction.update({
                content: `🛡️ **تم إرسال بلاغ الفحص بنجاح إلى غرفة الإدارة!**`,
                embeds: [],
                components: []
            });

            const adminChannel = interaction.guild.channels.cache.find(c => c.name === 'check-place-user') || interaction.channel;

            const reportEmbed = new EmbedBuilder()
                .setColor('#ffaa00')
                .setTitle('🚨 NEW PLAYER CHECK REPORT 🚨')
                .addFields(
                    { name: '👤 المبلغ (Reporter)', value: `${reporter} (${reporter.username})`, inline: false },
                    { name: '🎯 المشتبه به (Suspect)', value: `${suspectName}`, inline: true },
                    { name: '💻 المنصة (Platform)', value: `\`${session.platform}\``, inline: true }
                )
                .setFooter({ text: 'DEBBABI CHEAT • Admin Control Panel', iconURL: client.user.displayAvatarURL() })
                .setTimestamp();

            const adminActionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('check_clean').setLabel('Clean').setStyle(ButtonStyle.Success).setEmoji('🟢'),
                new ButtonBuilder().setCustomId('check_cheater').setLabel('Cheater').setStyle(ButtonStyle.Danger).setEmoji('🔴'),
                new ButtonBuilder().setCustomId('check_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary).setEmoji('❌'),
                new ButtonBuilder().setCustomId('check_kick').setLabel('Kick User').setStyle(ButtonStyle.Danger).setEmoji('👢')
            );

            await adminChannel.send({
                content: `📢 **تنبيه إداري جديد:** ${reporter} قام بالإبلاغ عن لاعب!`,
                embeds: [reportEmbed],
                components: [adminActionRow]
            });

            activeCheckSessions.delete(interaction.user.id);
        }

        else if (['check_clean', 'check_cheater', 'check_cancel', 'check_kick'].includes(interaction.customId)) {
            if (!interaction.member.permissions.has('Administrator')) {
                return interaction.reply({ content: '❌ هذه الأزرار مخصصة للإدارة فقط!', ephemeral: true });
            }

            const action = interaction.customId;

            if (action === 'check_clean') {
                await interaction.update({ content: `🟢 **تم تحديد الحالة بواسطة ${interaction.user}: اللاعب نظيف (Clean)!**`, components: [] });
            } else if (action === 'check_cheater') {
                await interaction.update({ content: `🔴 **تم تحديد الحالة بواسطة ${interaction.user}: ثبت أنه غشاش (Cheater)!**`, components: [] });
            } else if (action === 'check_cancel') {
                await interaction.update({ content: `❌ **تم إلغاء البلاغ بواسطة ${interaction.user}.**`, components: [] });
            } else if (action === 'check_kick') {
                await interaction.update({ content: `👢 **تم إغلاق البلاغ.** (قم بسحب العضو يدوياً).`, components: [] });
            }
        }
    }

    else if (interaction.isUserSelectMenu() && interaction.customId === 'select_suspect_user') {
        let session = activeCheckSessions.get(interaction.user.id) || { suspectId: null, platform: null };
        session.suspectId = interaction.values[0];
        activeCheckSessions.set(interaction.user.id, session);

        await interaction.update({ content: `✅ تم اختيار اللاعب بنجاح. اختر المنصة الآن واضغط Send Check.` }).catch(() => { });
    }

    else if (interaction.isStringSelectMenu() && interaction.customId === 'select_suspect_platform') {
        let session = activeCheckSessions.get(interaction.user.id) || { suspectId: null, platform: null };
        session.platform = interaction.values[0];
        activeCheckSessions.set(interaction.user.id, session);

        await interaction.update({ content: `✅ تم اختيار المنصة: **${session.platform}**. اضغط الآن على Send Check لإرسال البلاغ.` }).catch(() => { });
    }
});

client.login(process.env.DISCORD_TOKEN);