require("dotenv").config();

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

const fs = require("fs");
const path = require("path");

const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require("discord.js");

/* =========================
   CONFIG
========================= */
const PREFIX = "+";

// logs -> tout ici
const LOG_CHANNEL_ID = "1467550932316328140";

// auto role join
const AUTO_ROLE_ID = "1467554249885093888";

// storage config
const DATA_FILE = path.join(__dirname, "data.json");

// tickets UI ids
const TICKET_MENU_ID = "ticket_category_menu";
const TICKET_CLOSE_ID = "ticket_close_btn";

/**
 * Tickets -> catégories (TES IDs)
 */
const TICKET_TYPES = [
  { key: "nitro", label: "Ticket Nitro", emoji: "💗", categoryId: "1467589283459371110" },
  { key: "boost", label: "Tickets Boost", emoji: "📌", categoryId: "1467589315193213085" },
  { key: "decoration", label: "Ticket Decoration", emoji: "🎀", categoryId: "1467589354552561744" },
  { key: "exchanges", label: "Ticket Exchanges", emoji: "🔁", categoryId: "1467589401461919989" },

  { key: "bots_discord", label: "Ticket Bots Discord", emoji: "🤖", categoryId: "1467589553501245593" },
  { key: "scripts_fivem", label: "Ticket Script FiveM", emoji: "🛠️", categoryId: "1467589592004694179" },
  { key: "roblox_studio", label: "Ticket Roblox Studio", emoji: "🎮", categoryId: "1467589632290980056" },
  { key: "sites_web", label: "Ticket Sites Web", emoji: "🌐", categoryId: "1467589665837154394" },

  { key: "other", label: "Ticket Other", emoji: "📍", categoryId: "1467589426904432702" },
];

const defaultGuildConfig = {
  antiLink: true,
  antiSpam: true,
  antiRaid: true,
  antiBot: true,

  timeoutMinutes: 10,
  spam: { maxMsgs: 6, seconds: 5 },
  raid: { joinLimit: 6, seconds: 10, action: "timeout" }, // "timeout" | "kick"

  linkWhitelist: [],

  // WL bypass protect
  wlUsers: [], // user IDs
  wlRoles: [], // role IDs
};

/* =========================
   DATA STORE (JSON)
========================= */
function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return { guilds: {} };
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return { guilds: {} };
  }
}

function saveData(d) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2), "utf8");
}

const data = loadData();

function getGuildConfig(guildId) {
  if (!data.guilds[guildId]) {
    data.guilds[guildId] = { ...defaultGuildConfig };
    saveData(data);
  }
  data.guilds[guildId].wlUsers ||= [];
  data.guilds[guildId].wlRoles ||= [];
  data.guilds[guildId].linkWhitelist ||= [];
  return data.guilds[guildId];
}

function setGuildConfig(guildId, cfg) {
  data.guilds[guildId] = cfg;
  saveData(data);
}

/* =========================
   CLIENT
========================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
  ],
  partials: [Partials.Channel, Partials.Message],
});

/* =========================
   UTILS
========================= */
function isMod(member) {
  return (
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    member.permissions.has(PermissionsBitField.Flags.ManageGuild) ||
    member.permissions.has(PermissionsBitField.Flags.ModerateMembers) ||
    member.permissions.has(PermissionsBitField.Flags.ManageMessages)
  );
}

function containsLink(msg) {
  return /(https?:\/\/|www\.|discord\.gg\/|discord\.com\/invite\/)/i.test(msg);
}

function parseIdFromMention(str) {
  if (!str) return null;
  const m = String(str).match(/\d{15,25}/);
  return m ? m[0] : null;
}

function isWhitelistedMember(member, cfg) {
  if (!member) return false;
  if (cfg.wlUsers?.includes(member.id)) return true;
  const roleIds = member.roles?.cache ? Array.from(member.roles.cache.keys()) : [];
  return roleIds.some((rid) => cfg.wlRoles?.includes(rid));
}

async function sendLog(guild, embedOrContent) {
  try {
    if (!guild) return;
    const ch = await guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
    if (!ch || ch.type !== ChannelType.GuildText) return;

    if (typeof embedOrContent === "string") {
      await ch.send({ content: embedOrContent });
    } else {
      await ch.send({ embeds: [embedOrContent] });
    }
  } catch {
    // ignore
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* =========================
   ANTI-SPAM / ANTI-RAID MEMORY
========================= */
const msgBuckets = new Map(); // guildId:userId => timestamps
const joinBuckets = new Map(); // guildId => timestamps

function pushBucket(map, key, now) {
  if (!map.has(key)) map.set(key, []);
  const arr = map.get(key);
  arr.push(now);
  map.set(key, arr);
  return arr;
}

function cleanup(arr, windowMs, now) {
  while (arr.length && now - arr[0] > windowMs) arr.shift();
}

/* =========================
   HELP EMBED
========================= */
function buildHelpEmbed(cfg) {
  return new EmbedBuilder()
    .setTitle("📌 Help - Commandes")
    .setDescription(`Préfixe: \`${PREFIX}\`\nLogs: <#${LOG_CHANNEL_ID}>`)
    .addFields(
      {
        name: "🎫 Tickets",
        value:
          `\`${PREFIX}ticketpanel\` *(mod)* → panneau catégories (menu)\n` +
          `\`${PREFIX}rename <nom>\` → renommer le ticket\n` +
          `\`${PREFIX}close\` → fermer le ticket\n` +
          `→ Les tickets vont dans les bonnes catégories.`,
      },
      {
        name: "🧹 Clear",
        value: `\`${PREFIX}clear <nombre>\` *(mod)* → supprime des messages (1 à 100)\nEx: \`${PREFIX}clear 50\``,
      },
      {
        name: "🛡️ Protection",
        value:
          `\`${PREFIX}protect antiLink on/off\`\n` +
          `\`${PREFIX}protect antiSpam on/off\`\n` +
          `\`${PREFIX}protect antiRaid on/off\`\n` +
          `\`${PREFIX}protect antiBot on/off\`\n` +
          `Etat: antiLink=${cfg.antiLink ? "ON" : "OFF"} | antiSpam=${cfg.antiSpam ? "ON" : "OFF"} | antiRaid=${cfg.antiRaid ? "ON" : "OFF"} | antiBot=${cfg.antiBot ? "ON" : "OFF"}`,
      },
      {
        name: "🔗 Whitelist liens",
        value: `\`${PREFIX}whitelist <texte>\` *(mod)* → autorise un lien/domaine (ex: discord.gg/tonserveur)`,
      },
      {
        name: "✅ WL (bypass protect)",
        value:
          `\`${PREFIX}wl adduser @user\` *(mod)*\n` +
          `\`${PREFIX}wl deluser @user\` *(mod)*\n` +
          `\`${PREFIX}wl addrole @role\` *(mod)*\n` +
          `\`${PREFIX}wl delrole @role\` *(mod)*\n` +
          `\`${PREFIX}wl list\` *(mod)*`,
      },
      {
        name: "🧩 Massiv Role",
        value:
          `\`${PREFIX}massrole add @role\` *(mod)* → ajoute à tous\n` +
          `\`${PREFIX}massrole remove @role\` *(mod)* → retire à tous`,
      },
      {
        name: "🎉 Giveaway",
        value: `\`${PREFIX}giveaway <minutes> <prix>\` *(mod)*\nEx: \`${PREFIX}giveaway 10 Nitro\``,
      },
      {
        name: "🗣️ Say",
        value: `\`${PREFIX}say <texte>\` *(mod)*`,
      }
    )
    .setFooter({ text: "Bot Protect + Tickets + Logs" });
}

/* =========================
   READY
========================= */
client.once("ready", () => {
  console.log(`✅ Bot connecté : ${client.user.tag}`);
});

/* =========================
   AUTO ROLE + ANTI RAID + ANTI BOT
========================= */
client.on("guildMemberAdd", async (member) => {
  const cfg = getGuildConfig(member.guild.id);

  // auto-role
  const role = member.guild.roles.cache.get(AUTO_ROLE_ID);
  const okRole = role ? await member.roles.add(role).then(() => true).catch(() => false) : false;

  await sendLog(
    member.guild,
    new EmbedBuilder()
      .setTitle("👤 Member Join")
      .setDescription(`User: <@${member.id}> (\`${member.id}\`)\nAuto-role: <@&${AUTO_ROLE_ID}> → ${okRole ? "✅" : "❌"}`)
  );

  // anti-bot
  if (cfg.antiBot && member.user.bot) {
    const ok = await member.kick("Anti-bot").then(() => true).catch(() => false);
    await sendLog(
      member.guild,
      new EmbedBuilder().setTitle("🤖 Anti-bot").setDescription(`Bot: <@${member.id}> → kick ${ok ? "✅" : "❌"}`)
    );
    return;
  }

  // anti-raid
  if (!cfg.antiRaid) return;

  const now = Date.now();
  const arr = pushBucket(joinBuckets, member.guild.id, now);
  cleanup(arr, cfg.raid.seconds * 1000, now);

  if (arr.length >= cfg.raid.joinLimit) {
    if (cfg.raid.action === "kick") {
      const ok = await member.kick("Anti-raid").then(() => true).catch(() => false);
      await sendLog(
        member.guild,
        new EmbedBuilder()
          .setTitle("🚨 Anti-raid")
          .setDescription(`Join raid (>=${cfg.raid.joinLimit}/${cfg.raid.seconds}s)\nAction: kick <@${member.id}> → ${ok ? "✅" : "❌"}`)
      );
    } else {
      const ok = await member
        .timeout((cfg.timeoutMinutes ?? 10) * 60_000, "Anti-raid")
        .then(() => true)
        .catch(() => false);

      await sendLog(
        member.guild,
        new EmbedBuilder()
          .setTitle("🚨 Anti-raid")
          .setDescription(`Join raid (>=${cfg.raid.joinLimit}/${cfg.raid.seconds}s)\nAction: timeout <@${member.id}> (${cfg.timeoutMinutes}m) → ${ok ? "✅" : "❌"}`)
      );
    }
  }
});

/* =========================
   INTERACTIONS (Tickets Menu + Close Button)
========================= */
client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.guild) return;

    // Menu catégories tickets
    if (interaction.isStringSelectMenu() && interaction.customId === TICKET_MENU_ID) {
      const choice = interaction.values[0];
      const type = TICKET_TYPES.find((t) => t.key === choice);
      if (!type) return interaction.reply({ content: "❌ Catégorie invalide.", ephemeral: true });

      // 1 ticket max par user (par nom)
      const existing = interaction.guild.channels.cache.find(
        (c) => c.type === ChannelType.GuildText && c.name.startsWith(`ticket-${interaction.user.id}`)
      );
      if (existing) return interaction.reply({ content: `🎫 Ticket déjà ouvert : ${existing}`, ephemeral: true });

      // catégorie
      const parentCategory = await interaction.guild.channels.fetch(type.categoryId).catch(() => null);
      if (!parentCategory || parentCategory.type !== ChannelType.GuildCategory) {
        return interaction.reply({
          content: "❌ Catégorie ticket introuvable / pas une catégorie. Vérifie tes IDs.",
          ephemeral: true,
        });
      }

      const channel = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.id}`,
        type: ChannelType.GuildText,
        parent: parentCategory.id,
        topic: `Ticket | ${type.label} | ${interaction.user.tag} (${interaction.user.id})`,
        permissionOverwrites: [
          { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          {
            id: interaction.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.AttachFiles,
            ],
          },
          {
            id: client.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.ManageMessages,
            ],
          },
        ],
      });

      const closeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(TICKET_CLOSE_ID).setLabel("Fermer").setStyle(ButtonStyle.Danger)
      );

      const embed = new EmbedBuilder()
        .setTitle(`${type.emoji} ${type.label}`)
        .setDescription(`Bonjour <@${interaction.user.id}> !\nExplique ton problème ici.`)
        .setFooter({ text: "Clique sur Fermer ou fais +close quand c'est terminé." });

      await channel.send({ embeds: [embed], components: [closeRow] });

      await sendLog(
        interaction.guild,
        new EmbedBuilder()
          .setTitle("🎫 Ticket créé")
          .setDescription(`User: <@${interaction.user.id}>\nCatégorie: **${type.label}**\nSalon: ${channel}`)
      );

      return interaction.reply({ content: `✅ Ticket créé : ${channel}`, ephemeral: true });
    }

    // fermer ticket (bouton)
    if (interaction.isButton() && interaction.customId === TICKET_CLOSE_ID) {
      const isTicket = interaction.channel?.name?.startsWith("ticket-");
      if (!isTicket) return interaction.reply({ content: "❌ Pas un ticket.", ephemeral: true });

      const parts = interaction.channel.name.split("-");
      const ownerId = parts.length >= 2 ? parts[1] : null;
      const isOwner = ownerId === interaction.user.id;
      const canClose = isOwner || isMod(interaction.member);

      if (!canClose) return interaction.reply({ content: "❌ Tu ne peux pas fermer ce ticket.", ephemeral: true });

      await sendLog(
        interaction.guild,
        new EmbedBuilder()
          .setTitle("🔒 Ticket fermé")
          .setDescription(`Salon: <#${interaction.channel.id}>\nPar: <@${interaction.user.id}>`)
      );

      await interaction.reply({ content: "🔒 Ticket fermé dans 5 secondes..." });
      setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
    }
  } catch (e) {
    console.error(e);
    if (interaction.isRepliable()) interaction.reply({ content: "❌ Erreur.", ephemeral: true }).catch(() => {});
  }
});

/* =========================
   MESSAGE CREATE (Protect + Commands)
========================= */
client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot) return;

  const guildId = message.guild.id;
  const cfg = getGuildConfig(guildId);

  const mod = isMod(message.member);
  const wl = isWhitelistedMember(message.member, cfg);
  const bypass = mod || wl;

  // ANTI LINK
  if (cfg.antiLink && !bypass && containsLink(message.content)) {
    const ok = (cfg.linkWhitelist || []).some((x) =>
      message.content.toLowerCase().includes(String(x).toLowerCase())
    );
    if (!ok) {
      await message.delete().catch(() => {});
      await sendLog(
        message.guild,
        new EmbedBuilder()
          .setTitle("🔗 Anti-link")
          .setDescription(
            `Message supprimé\nUser: <@${message.author.id}>\nSalon: ${message.channel}\nContenu: \`${message.content.slice(0, 180)}\``
          )
      );
      return message.channel
        .send("🔗 Les liens sont interdits.")
        .then((m) => setTimeout(() => m.delete().catch(() => {}), 4000));
    }
  }

  // ANTI SPAM
  if (cfg.antiSpam && !bypass) {
    const now = Date.now();
    const key = `${guildId}:${message.author.id}`;
    const arr = pushBucket(msgBuckets, key, now);
    cleanup(arr, cfg.spam.seconds * 1000, now);

    if (arr.length >= cfg.spam.maxMsgs) {
      const ok = await message.member
        .timeout((cfg.timeoutMinutes ?? 10) * 60_000, "Anti-spam")
        .then(() => true)
        .catch(() => false);

      await sendLog(
        message.guild,
        new EmbedBuilder()
          .setTitle("⛔ Anti-spam")
          .setDescription(
            `User: <@${message.author.id}>\nAction: timeout ${cfg.timeoutMinutes}m → ${ok ? "✅" : "❌"}\nSalon: ${message.channel}`
          )
      );

      return message.channel
        .send(`⛔ ${message.author} spam détecté`)
        .then((m) => setTimeout(() => m.delete().catch(() => {}), 5000));
    }
  }

  /* =========================
     COMMANDES PREFIX +
  ========================= */
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const cmd = (args.shift() || "").toLowerCase();

  // +help
  if (cmd === "help") {
    return message.channel.send({ embeds: [buildHelpEmbed(cfg)] });
  }

  // +clear <1-100>
  if (cmd === "clear") {
    if (!mod) return message.reply("❌ Pas la permission.");

    let amount = parseInt(args[0], 10);
    if (!amount || isNaN(amount)) amount = 10;
    if (amount < 1) amount = 1;
    if (amount > 100) amount = 100;

    const deleted = await message.channel.bulkDelete(amount, true).catch(() => null);
    const count = deleted ? deleted.size : 0;

    await sendLog(
      message.guild,
      new EmbedBuilder()
        .setTitle("🧹 Clear")
        .setDescription(`Par: <@${message.author.id}>\nSalon: ${message.channel}\nDemandé: ${amount}\nSupprimé: ${count}`)
    );

    return message.channel
      .send(`🧹 Supprimé **${count}** message(s).`)
      .then((m) => setTimeout(() => m.delete().catch(() => {}), 4000));
  }

  // +say
  if (cmd === "say") {
    if (!mod) return message.reply("❌ Pas la permission.");
    await message.delete().catch(() => {});
    await sendLog(message.guild, `🗣️ **SAY** par <@${message.author.id}> dans ${message.channel}`);
    return message.channel.send(args.join(" ") || " ");
  }

  // +ticketpanel
  if (cmd === "ticketpanel") {
    if (!mod) return message.reply("❌ Pas la permission.");

    const embed = new EmbedBuilder()
      .setTitle("🎫 Tickets")
      .setDescription("Choisis une catégorie dans le menu pour ouvrir un ticket.");

    const menu = new StringSelectMenuBuilder()
      .setCustomId(TICKET_MENU_ID)
      .setPlaceholder("Choisir une catégorie...")
      .addOptions(TICKET_TYPES.map((t) => ({ label: t.label, value: t.key, emoji: t.emoji })));

    const row = new ActionRowBuilder().addComponents(menu);

    await sendLog(message.guild, `🎫 **Ticket Panel** envoyé par <@${message.author.id}> dans ${message.channel}`);
    return message.channel.send({ embeds: [embed], components: [row] });
  }

  // ✅ +rename <nom> (ticket)
  if (cmd === "rename") {
    const isTicket = message.channel.type === ChannelType.GuildText && message.channel.name.startsWith("ticket-");
    if (!isTicket) return message.reply("❌ Cette commande fonctionne uniquement dans un ticket.");

    const parts = message.channel.name.split("-");
    const ownerId = parts.length >= 2 ? parts[1] : null;
    const isOwner = ownerId === message.author.id;

    if (!isOwner && !mod) return message.reply("❌ Tu ne peux pas renommer ce ticket.");

    let newLabel = args.join("-").toLowerCase().replace(/[^a-z0-9\-]/g, "");
    if (!newLabel) return message.reply("❌ Utilise: `+rename nouveau-nom`");

    if (newLabel.length > 40) newLabel = newLabel.slice(0, 40);

    const oldName = message.channel.name;
    const newChannelName = `ticket-${ownerId}-${newLabel}`.slice(0, 100);

    const ok = await message.channel.setName(newChannelName).then(() => true).catch(() => false);
    if (!ok) return message.reply("❌ Impossible de renommer le ticket (permissions / limite).");

    await sendLog(
      message.guild,
      new EmbedBuilder()
        .setTitle("✏️ Ticket renommé")
        .setDescription(`Par: <@${message.author.id}>\nAncien: **${oldName}**\nNouveau: **${newChannelName}**\nSalon: <#${message.channel.id}>`)
    );

    return message.reply(`✅ Ticket renommé en **${newChannelName}**`);
  }

  // ✅ +close (ticket)
  if (cmd === "close") {
    const isTicket = message.channel.type === ChannelType.GuildText && message.channel.name.startsWith("ticket-");
    if (!isTicket) return message.reply("❌ Cette commande fonctionne uniquement dans un ticket.");

    const parts = message.channel.name.split("-");
    const ownerId = parts.length >= 2 ? parts[1] : null;
    const isOwner = ownerId === message.author.id;

    if (!isOwner && !mod) return message.reply("❌ Tu ne peux pas fermer ce ticket.");

    await sendLog(
      message.guild,
      new EmbedBuilder()
        .setTitle("🔒 Ticket fermé")
        .setDescription(`Par: <@${message.author.id}>\nSalon: <#${message.channel.id}> (\`${message.channel.name}\`)`)
    );

    await message.reply("🔒 Ticket fermé dans 5 secondes...");
    setTimeout(() => message.channel.delete().catch(() => {}), 5000);
    return;
  }

  // +giveaway <minutes> <prize...>
  if (cmd === "giveaway") {
    if (!mod) return message.reply("❌ Pas la permission.");

    const minutes = parseInt(args[0], 10);
    const prize = args.slice(1).join(" ");

    if (!minutes || minutes <= 0 || !prize) return message.reply(`❌ Utilise: \`${PREFIX}giveaway 10 Nitro\``);

    const embed = new EmbedBuilder()
      .setTitle("🎉 GIVEAWAY")
      .setDescription(`Prix: **${prize}**\nRéagis avec 🎉 pour participer !`)
      .setFooter({ text: `Fin dans ${minutes} min` });

    const msg = await message.channel.send({ embeds: [embed] });
    await msg.react("🎉");

    await sendLog(
      message.guild,
      new EmbedBuilder()
        .setTitle("🎉 Giveaway")
        .setDescription(`Créé par: <@${message.author.id}>\nSalon: ${message.channel}\nDurée: ${minutes} min\nPrix: **${prize}**`)
    );

    setTimeout(async () => {
      const reaction = msg.reactions.cache.get("🎉");
      const users = reaction ? await reaction.users.fetch().catch(() => null) : null;

      const participants = users ? users.filter((u) => !u.bot) : null;
      if (!participants || participants.size === 0) {
        await sendLog(message.guild, "🎉 Giveaway terminé → aucun participant.");
        return message.channel.send("😭 Personne n'a participé.");
      }

      const arr = Array.from(participants.values());
      const winner = arr[Math.floor(Math.random() * arr.length)];

      await sendLog(message.guild, `🎉 Giveaway terminé → gagnant: ${winner.tag} (\`${winner.id}\`)`);
      message.channel.send(`🎉 Gagnant: ${winner}`);
    }, minutes * 60_000);
  }

  // +protect <antiLink|antiSpam|antiRaid|antiBot> <on/off>
  if (cmd === "protect") {
    if (!mod) return message.reply("❌ Pas la permission.");

    const key = args[0];
    const val = (args[1] || "").toLowerCase();
    if (!["antiLink", "antiSpam", "antiRaid", "antiBot"].includes(key)) {
      return message.reply(`❌ Utilise: \`${PREFIX}protect antiLink on/off\` (antiSpam/antiRaid/antiBot)`);
    }

    cfg[key] = val === "on";
    setGuildConfig(guildId, cfg);

    await sendLog(message.guild, `🛡️ Protect: **${key}** → **${cfg[key] ? "ON" : "OFF"}** (par <@${message.author.id}>)`);
    return message.reply(`🛡️ ${key} → **${cfg[key] ? "ON" : "OFF"}**`);
  }

  // +whitelist <texte>
  if (cmd === "whitelist") {
    if (!mod) return message.reply("❌ Pas la permission.");

    const text = args.join(" ");
    if (!text) return message.reply(`❌ Utilise: \`${PREFIX}whitelist discord.gg/tonserveur\``);

    cfg.linkWhitelist ||= [];
    if (!cfg.linkWhitelist.includes(text)) cfg.linkWhitelist.push(text);
    setGuildConfig(guildId, cfg);

    await sendLog(message.guild, `🔗 Link whitelist ajouté: **${text}** (par <@${message.author.id}>)`);
    return message.reply(`✅ Ajouté à la whitelist liens: **${text}**`);
  }

  // +wl ...
  if (cmd === "wl") {
    if (!mod) return message.reply("❌ Pas la permission.");

    const sub = (args.shift() || "").toLowerCase();

    if (sub === "list") {
      const u = (cfg.wlUsers || []).map((id) => `<@${id}>`).join(", ") || "Aucun";
      const r = (cfg.wlRoles || []).map((id) => `<@&${id}>`).join(", ") || "Aucun";
      const emb = new EmbedBuilder().setTitle("✅ WL List").addFields({ name: "Users", value: u }, { name: "Roles", value: r });
      return message.channel.send({ embeds: [emb] });
    }

    if (sub === "adduser" || sub === "deluser") {
      const targetId = message.mentions.users.first()?.id || parseIdFromMention(args[0]);
      if (!targetId) return message.reply(`❌ Utilise: \`${PREFIX}wl ${sub} @user\``);

      cfg.wlUsers ||= [];
      const exists = cfg.wlUsers.includes(targetId);

      if (sub === "adduser" && !exists) cfg.wlUsers.push(targetId);
      if (sub === "deluser" && exists) cfg.wlUsers = cfg.wlUsers.filter((x) => x !== targetId);

      setGuildConfig(guildId, cfg);
      await sendLog(message.guild, `✅ WL user ${sub === "adduser" ? "ajouté" : "retiré"}: <@${targetId}> (par <@${message.author.id}>)`);
      return message.reply(`✅ WL user ${sub === "adduser" ? "ajouté" : "retiré"}: <@${targetId}>`);
    }

    if (sub === "addrole" || sub === "delrole") {
      const roleId = message.mentions.roles.first()?.id || parseIdFromMention(args[0]);
      if (!roleId) return message.reply(`❌ Utilise: \`${PREFIX}wl ${sub} @role\``);

      cfg.wlRoles ||= [];
      const exists = cfg.wlRoles.includes(roleId);

      if (sub === "addrole" && !exists) cfg.wlRoles.push(roleId);
      if (sub === "delrole" && exists) cfg.wlRoles = cfg.wlRoles.filter((x) => x !== roleId);

      setGuildConfig(guildId, cfg);
      await sendLog(message.guild, `✅ WL role ${sub === "addrole" ? "ajouté" : "retiré"}: <@&${roleId}> (par <@${message.author.id}>)`);
      return message.reply(`✅ WL role ${sub === "addrole" ? "ajouté" : "retiré"}: <@&${roleId}>`);
    }

    return message.reply(
      `❌ Utilise:\n` +
        `\`${PREFIX}wl adduser @user\`\n\`${PREFIX}wl deluser @user\`\n` +
        `\`${PREFIX}wl addrole @role\`\n\`${PREFIX}wl delrole @role\`\n` +
        `\`${PREFIX}wl list\``
    );
  }

  // +massrole add/remove @role
  if (cmd === "massrole") {
    if (!mod) return message.reply("❌ Pas la permission.");

    const sub = (args.shift() || "").toLowerCase();
    const roleId = message.mentions.roles.first()?.id || parseIdFromMention(args[0]);

    if (!["add", "remove"].includes(sub) || !roleId) {
      return message.reply(`❌ Utilise: \`${PREFIX}massrole add @role\` ou \`${PREFIX}massrole remove @role\``);
    }

    const role = await message.guild.roles.fetch(roleId).catch(() => null);
    if (!role) return message.reply("❌ Rôle introuvable.");
    if (role.managed) return message.reply("❌ Rôle géré (bot/integration), impossible.");

    const me = await message.guild.members.fetchMe().catch(() => null);
    if (!me) return message.reply("❌ Impossible de vérifier le bot.");
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) return message.reply("❌ Le bot n'a pas Manage Roles.");
    if (role.position >= me.roles.highest.position) return message.reply("❌ Le rôle est au-dessus (ou égal) au rôle du bot.");

    const members = await message.guild.members.fetch().catch(() => null);
    if (!members) return message.reply("❌ Impossible de fetch les membres.");

    await sendLog(message.guild, `🧩 Massrole **${sub}** <@&${roleId}> démarré par <@${message.author.id}>`);

    let done = 0;
    let fail = 0;

    const statusMsg = await message.reply(`⏳ Massrole ${sub} <@&${roleId}> en cours...`);

    for (const [, m] of members) {
      try {
        if (sub === "add") {
          if (!m.roles.cache.has(roleId)) await m.roles.add(roleId);
        } else {
          if (m.roles.cache.has(roleId)) await m.roles.remove(roleId);
        }
        done++;
      } catch {
        fail++;
      }

      if ((done + fail) % 10 === 0) await sleep(1200);
    }

    await statusMsg.edit(`✅ Massrole terminé: ${sub} <@&${roleId}>\n✅ Réussite: **${done}**\n❌ Échec: **${fail}**`);
    await sendLog(message.guild, `🧩 Massrole terminé: ${sub} <@&${roleId}> | ok=${done} | fail=${fail}`);
    return;
  }

  // commande inconnue
  return message.reply(`❓ Commande inconnue. Fais \`${PREFIX}help\``);
});

// login (avec check)
const token = process.env.TOKEN;
if (!token || token.length < 20) {
  console.error("❌ TOKEN manquant/invalide. Mets TOKEN dans Railway Variables/Shared Variables.");
} else {
  client.login(token);
}
