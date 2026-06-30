import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  Events,
  TextChannel,
  type Interaction,
  type Message,
} from "discord.js";
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

async function registerCommands(clientId: string) {
  if (!BOT_TOKEN) return;
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

  const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    logger.info("Slash commands /visu e /avatar registrados com sucesso.");
  } catch (err) {
    logger.error({ err }, "Erro ao registrar slash commands.");
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  logger.info({ tag: readyClient.user.tag }, "Bot do Discord conectado");
  await registerCommands(readyClient.user.id);
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

      const member = await interaction.guild?.members.fetch(
        interaction.user.id
      );
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

      const embed = new EmbedBuilder()
        .setColor(0x00f0ff)
        .setTitle(`Perfil do Usuário - ${displayName}`)
        .setDescription(
          `**Mensagens Enviadas:** ${messageCount.toLocaleString("pt-BR")}\n\n**Cargos:** ${roles}`
        )
        .setImage(interaction.user.displayAvatarURL({ size: 1024 }))
        .setFooter({ text: "Use /visu para ver seu perfil" });

      const channel = interaction.channel as TextChannel;
      await channel.send({ embeds: [embed] });
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
        .setColor(0x00f0ff)
        .setImage(avatarUrl)
        .setFooter({ text: "Digite /avatar para mostrar o seu!" });

      const channel = interaction.channel as TextChannel;
      await channel.send({ embeds: [embed] });
      await interaction.deleteReply();
    } catch (err) {
      logger.error({ err }, "Erro ao executar /avatar");
      const msg =
        err instanceof Error ? err.message : "Erro desconhecido.";
      try {
        await interaction.editReply({
          content: `❄️ ${msg}`,
        });
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
