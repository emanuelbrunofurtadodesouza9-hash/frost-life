import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  Events,
  TextChannel,
  type Interaction,
  type Message,
} from "discord.js";
import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import { logger } from "./lib/logger";

const BOT_TOKEN = process.env["BOT_TOKEN"];
const GEMINI_KEY = process.env["GEMINI_KEY"];

const VISU_CHANNEL_ID = "1521626552335601724";
const FAQ_CHANNEL_ID = "1499875670128590969";
const AVATAR_CHANNEL_ID = "1506813878976385094";

const messageCounts = new Map<string, number>();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.Message],
});

async function clearGlobalCommands(clientId: string, rest: REST) {
  try {
    await rest.put(Routes.applicationCommands(clientId), { body: [] });
    logger.info("Comandos globais removidos.");
  } catch (err) {
    logger.error({ err }, "Erro ao remover comandos globais.");
  }
}

async function registerCommands(clientId: string, guildId: string, rest: REST) {
  const commands = [
    new SlashCommandBuilder()
      .setName("visu")
      .setDescription("Mostra o perfil detalhado do seu usuário no servidor.")
      .toJSON(),
    new SlashCommandBuilder()
      .setName("avatar")
      .setDescription("Mostra o avatar do seu personagem no Roblox.")
      .addStringOption((opt) =>
        opt
          .setName("username")
          .setDescription("Seu nome de usuário no Roblox")
          .setRequired(true)
      )
      .toJSON(),
  ];

  try {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commands,
    });
    logger.info({ guildId }, "Slash commands /visu e /avatar registrados (guild).");
  } catch (err) {
    logger.error({ err }, "Erro ao registrar slash commands.");
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  logger.info({ tag: readyClient.user.tag }, "Bot do Discord conectado");
  if (!BOT_TOKEN) return;
  const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);
  await clearGlobalCommands(readyClient.user.id, rest);
  for (const guild of readyClient.guilds.cache.values()) {
    await registerCommands(readyClient.user.id, guild.id, rest);
  }
});

client.on(Events.MessageCreate, async (message: Message) => {
  if (message.author.bot) return;

  const current = messageCounts.get(message.author.id) ?? 0;
  messageCounts.set(message.author.id, current + 1);

  if (message.channelId !== FAQ_CHANNEL_ID) return;

  const isMentioned =
    message.mentions.has(client.user!) ||
    (message.channel.isDMBased() && !message.author.bot);

  if (!isMentioned) return;

  try {
    await message.channel.sendTyping();

    const userText = message.content.replace(/<@!?\d+>/g, "").trim();

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;

    const body = {
      contents: [
        {
          parts: [
            {
              text: `Você é a IA de suporte e ajuda do servidor do Discord chamado 'Frost Life'. Sua personalidade é prestativa, fria e moderna (use emojis de gelo e neve ❄️🧊). Você deve responder à dúvida do usuário de forma direta e inteligente, explicando tudo detalhadamente. Lembre-se: Você serve exclusivamente para dar suporte e tirar dúvidas do servidor, não puxe assuntos aleatórios fora do contexto do servidor. Pergunta do usuário: ${userText}`,
            },
          ],
        },
      ],
    };

    const res = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const dataIA = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };

    const resposta =
      dataIA?.candidates?.[0]?.content?.parts?.[0]?.text ??
      "❄️ Não consegui processar sua pergunta. Tente novamente!";

    await message.reply(resposta);
  } catch (err) {
    logger.error({ err }, "Erro ao chamar Gemini API");
    await message.reply(
      "🧊 Ocorreu um erro ao processar sua pergunta. Tente novamente mais tarde!"
    );
  }
});

async function buildProfileCard(
  avatarUrl: string,
  displayName: string,
  messageCount: number,
  roles: string
): Promise<Buffer> {
  const W = 600;
  const H = 420;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Background gradient (dark blue)
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#0a0e2a");
  bg.addColorStop(1, "#0d1f3c");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Glowing border
  ctx.strokeStyle = "#00f0ff";
  ctx.lineWidth = 3;
  ctx.strokeRect(6, 6, W - 12, H - 12);

  // Header bar
  const hdr = ctx.createLinearGradient(0, 0, W, 0);
  hdr.addColorStop(0, "#00f0ff22");
  hdr.addColorStop(1, "#0057ff22");
  ctx.fillStyle = hdr;
  ctx.fillRect(6, 6, W - 12, 60);

  // Header label
  ctx.fillStyle = "#00f0ff";
  ctx.font = "bold 20px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("❄  PERFIL DO USUÁRIO  ❄", W / 2, 44);

  // Avatar (circular)
  const AX = W / 2;
  const AY = 175;
  const RADIUS = 80;

  const avatar = await loadImage(avatarUrl);
  ctx.save();
  ctx.beginPath();
  ctx.arc(AX, AY, RADIUS, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(avatar, AX - RADIUS, AY - RADIUS, RADIUS * 2, RADIUS * 2);
  ctx.restore();

  // Avatar glow ring
  ctx.beginPath();
  ctx.arc(AX, AY, RADIUS + 4, 0, Math.PI * 2);
  ctx.strokeStyle = "#00f0ff";
  ctx.lineWidth = 3;
  ctx.stroke();

  // Display name
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 26px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(displayName, W / 2, 288);

  // Divider
  ctx.strokeStyle = "#00f0ff55";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(60, 305);
  ctx.lineTo(W - 60, 305);
  ctx.stroke();

  // Messages
  ctx.font = "bold 16px sans-serif";
  ctx.fillStyle = "#00f0ff";
  ctx.textAlign = "left";
  ctx.fillText("💬  Mensagens Enviadas", 60, 335);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "right";
  ctx.fillText(messageCount.toLocaleString("pt-BR"), W - 60, 335);

  // Roles
  ctx.fillStyle = "#00f0ff";
  ctx.textAlign = "left";
  ctx.fillText("🎭  Cargos", 60, 368);
  ctx.fillStyle = "#cccccc";
  ctx.font = "15px sans-serif";
  ctx.textAlign = "right";
  const rolesText = roles.length > 40 ? roles.slice(0, 40) + "…" : roles;
  ctx.fillText(rolesText, W - 60, 368);

  // Footer
  ctx.fillStyle = "#ffffff55";
  ctx.font = "13px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Use /visu para ver seu perfil", W / 2, 406);

  return canvas.toBuffer("image/png");
}

async function getRobloxAvatarUrl(username: string): Promise<string> {
  const usersRes = await fetch("https://users.roblox.com/v1/usernames/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
  });
  const usersData = (await usersRes.json()) as { data?: { id: number }[] };
  const userId = usersData?.data?.[0]?.id;
  if (!userId) throw new Error(`Usuário Roblox "${username}" não encontrado.`);

  const thumbRes = await fetch(
    `https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=420x420&format=Png&isCircular=false`
  );
  const thumbData = (await thumbRes.json()) as {
    data?: { imageUrl?: string }[];
  };
  const imageUrl = thumbData?.data?.[0]?.imageUrl;
  if (!imageUrl) throw new Error("Não foi possível obter o avatar do Roblox.");
  return imageUrl;
}

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // ─── /visu ───────────────────────────────────────────────
  if (interaction.commandName === "visu") {
    if (interaction.channelId !== VISU_CHANNEL_ID) {
      await interaction.reply({
        content: `Eita! Você não pode usar esse comando aqui! Tente em <#${VISU_CHANNEL_ID}>`,
        ephemeral: true,
      });
      return;
    }

    try {
      await interaction.deferReply({ ephemeral: true });

      const member = await interaction.guild?.members.fetch(interaction.user.id);
      const messageCount = messageCounts.get(interaction.user.id) ?? 0;

      const roles =
        member?.roles.cache
          .filter((r) => r.name !== "@everyone")
          .map((r) => r.name)
          .join(", ") || "Nenhum cargo";

      const displayName =
        member?.displayName ??
        interaction.user.globalName ??
        interaction.user.username;

      const avatarUrl = interaction.user.displayAvatarURL({ size: 256, extension: "png" });

      const cardBuffer = await buildProfileCard(avatarUrl, displayName, messageCount, roles);
      const attachment = new AttachmentBuilder(cardBuffer, { name: "perfil.png" });

      const channel = interaction.channel as TextChannel;
      await channel.send({ files: [attachment] });
      await interaction.deleteReply();
    } catch (err) {
      logger.error({ err }, "Erro ao executar /visu");
      try {
        await interaction.editReply({
          content: "❄️ Ocorreu um erro ao carregar seu perfil. Tente novamente!",
        });
      } catch {
        /* already deleted */
      }
    }
    return;
  }

  // ─── /avatar ─────────────────────────────────────────────
  if (interaction.commandName === "avatar") {
    if (interaction.channelId !== AVATAR_CHANNEL_ID) {
      await interaction.reply({
        content: `Eita! Você não pode usar esse comando aqui! Tente em <#${AVATAR_CHANNEL_ID}>`,
        ephemeral: true,
      });
      return;
    }

    const username = interaction.options.getString("username", true);

    try {
      await interaction.deferReply({ ephemeral: true });

      const avatarUrl = await getRobloxAvatarUrl(username);

      const embed = new EmbedBuilder()
        .setImage(avatarUrl)
        .setFooter({ text: "Digite /avatar para mostrar o seu!" });

      const channel = interaction.channel as TextChannel;
      await channel.send({ embeds: [embed] });
      await interaction.deleteReply();
    } catch (err) {
      logger.error({ err }, "Erro ao executar /avatar");
      const msg = err instanceof Error ? err.message : "Erro desconhecido.";
      try {
        await interaction.editReply({ content: `❄️ ${msg}` });
      } catch {
        /* already deleted */
      }
    }
    return;
  }
});

export function startBot() {
  if (!BOT_TOKEN) {
    logger.warn("BOT_TOKEN não definido — bot do Discord não iniciado.");
    return;
  }
  client.login(BOT_TOKEN).catch((err) => {
    logger.error({ err }, "Falha ao iniciar o bot do Discord");
  });
}
