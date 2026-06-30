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
let geminiModel = "gemini-2.0-flash"; // will be overridden at startup

async function discoverGeminiModel(): Promise<string> {
  const preferred = [
    "gemini-2.0-flash-lite",
    "gemini-2.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-2.0-flash",
    "gemini-2.5-flash",
  ];
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_KEY}`
    );
    const data = (await res.json()) as {
      models?: { name: string; supportedGenerationMethods?: string[] }[];
    };
    const available = (data.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => m.name.replace("models/", ""));

    logger.info({ available }, "Modelos Gemini disponíveis");

    for (const p of preferred) {
      if (available.includes(p)) return p;
    }
    if (available.length > 0) return available[0]!;
  } catch (err) {
    logger.error({ err }, "Erro ao listar modelos Gemini");
  }
  return "gemini-2.0-flash"; // último recurso
}

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
  geminiModel = await discoverGeminiModel();
  logger.info({ geminiModel }, "Modelo Gemini selecionado");
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

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${GEMINI_KEY}`;

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
      error?: { code?: number; message?: string; status?: string };
    };

    logger.info({ status: res.status, dataIA: JSON.stringify(dataIA).slice(0, 400) }, "Resposta Gemini");

    if (dataIA.error) {
      logger.error({ geminiError: dataIA.error }, "Erro retornado pela API do Gemini");
      await message.reply(`🧊 Erro da IA: ${dataIA.error.message ?? "resposta inválida"}`);
      return;
    }

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

function drawRoundRect(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  x: number, y: number, w: number, h: number, r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

async function buildProfileCard(
  avatarUrl: string,
  displayName: string,
  messageCount: number,
  roleList: string[]
): Promise<Buffer> {
  const W = 620;
  const PAD = 60;
  const PILL_H = 28;
  const PILL_GAP_X = 8;
  const PILL_GAP_Y = 8;
  const FONT_PILL = "13px sans-serif";

  // Pre-calculate pill layout on a temp canvas to measure text
  const tmp = createCanvas(W, 100);
  const tmpCtx = tmp.getContext("2d");
  tmpCtx.font = FONT_PILL;

  type Pill = { label: string; w: number };
  const pills: Pill[] = roleList.map((r) => ({
    label: r,
    w: Math.ceil(tmpCtx.measureText(r).width) + 20,
  }));

  // Wrap pills into rows
  const maxRowW = W - PAD * 2;
  const rows: Pill[][] = [];
  let row: Pill[] = [];
  let rowW = 0;
  for (const pill of pills) {
    if (row.length > 0 && rowW + PILL_GAP_X + pill.w > maxRowW) {
      rows.push(row);
      row = [];
      rowW = 0;
    }
    row.push(pill);
    rowW += (row.length > 1 ? PILL_GAP_X : 0) + pill.w;
  }
  if (row.length > 0) rows.push(row);

  const rolesBlockH = rows.length === 0
    ? PILL_H
    : rows.length * PILL_H + (rows.length - 1) * PILL_GAP_Y;

  // Fixed sections heights
  const HEADER_H = 66;
  const AVATAR_R = 80;
  const AVATAR_CY = HEADER_H + 20 + AVATAR_R;       // avatar center y
  const NAME_Y = AVATAR_CY + AVATAR_R + 30;
  const DIVIDER_Y = NAME_Y + 20;
  const MSG_Y = DIVIDER_Y + 36;
  const ROLES_LABEL_Y = MSG_Y + 44;
  const ROLES_START_Y = ROLES_LABEL_Y + 14;
  const FOOTER_H = 36;
  const H = ROLES_START_Y + rolesBlockH + FOOTER_H + 20;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Background gradient
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
  ctx.fillRect(6, 6, W - 12, HEADER_H - 6);

  ctx.fillStyle = "#00f0ff";
  ctx.font = "bold 20px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("❄  PERFIL DO USUÁRIO  ❄", W / 2, 44);

  // Avatar (circular)
  const AX = W / 2;
  const avatar = await loadImage(avatarUrl);
  ctx.save();
  ctx.beginPath();
  ctx.arc(AX, AVATAR_CY, AVATAR_R, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(avatar, AX - AVATAR_R, AVATAR_CY - AVATAR_R, AVATAR_R * 2, AVATAR_R * 2);
  ctx.restore();

  // Avatar glow ring
  ctx.beginPath();
  ctx.arc(AX, AVATAR_CY, AVATAR_R + 4, 0, Math.PI * 2);
  ctx.strokeStyle = "#00f0ff";
  ctx.lineWidth = 3;
  ctx.stroke();

  // Display name
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 26px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(displayName, W / 2, NAME_Y);

  // Divider
  ctx.strokeStyle = "#00f0ff55";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, DIVIDER_Y);
  ctx.lineTo(W - PAD, DIVIDER_Y);
  ctx.stroke();

  // Messages row
  ctx.font = "bold 16px sans-serif";
  ctx.fillStyle = "#00f0ff";
  ctx.textAlign = "left";
  ctx.fillText("💬  Mensagens Enviadas", PAD, MSG_Y);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "right";
  ctx.fillText(messageCount.toLocaleString("pt-BR"), W - PAD, MSG_Y);

  // Roles label
  ctx.font = "bold 16px sans-serif";
  ctx.fillStyle = "#00f0ff";
  ctx.textAlign = "left";
  ctx.fillText("🎭  Cargos", PAD, ROLES_LABEL_Y);

  // Role pills
  ctx.font = FONT_PILL;
  let py = ROLES_START_Y;
  for (const pillRow of rows) {
    let px = PAD;
    for (const pill of pillRow) {
      // Pill background
      ctx.fillStyle = "#00f0ff18";
      drawRoundRect(ctx, px, py, pill.w, PILL_H, 6);
      ctx.fill();
      // Pill border
      ctx.strokeStyle = "#00f0ff66";
      ctx.lineWidth = 1;
      drawRoundRect(ctx, px, py, pill.w, PILL_H, 6);
      ctx.stroke();
      // Pill text
      ctx.fillStyle = "#e0f8ff";
      ctx.textAlign = "left";
      ctx.fillText(pill.label, px + 10, py + PILL_H - 8);
      px += pill.w + PILL_GAP_X;
    }
    py += PILL_H + PILL_GAP_Y;
  }

  if (roleList.length === 0) {
    ctx.fillStyle = "#999999";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("Nenhum cargo", PAD, ROLES_START_Y + PILL_H - 8);
  }

  // Footer
  ctx.fillStyle = "#ffffff44";
  ctx.font = "13px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Use /visu para ver seu perfil", W / 2, H - 12);

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

      const roleList =
        member?.roles.cache
          .filter((r) => r.name !== "@everyone")
          .sort((a, b) => b.position - a.position)
          .map((r) => r.name) ?? [];

      const displayName =
        member?.displayName ??
        interaction.user.globalName ??
        interaction.user.username;

      const avatarUrl = interaction.user.displayAvatarURL({ size: 256, extension: "png" });

      const cardBuffer = await buildProfileCard(avatarUrl, displayName, messageCount, roleList);
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
