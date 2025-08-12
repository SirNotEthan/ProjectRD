import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, ButtonInteraction, Message } from 'discord.js';
import type { ColorResolvable } from 'discord.js';

interface LatencyStatus {
    emoji: string;
    status: string;
    color: ColorResolvable;
}

interface PingMetrics {
    roundTripLatency: number;
    websocketLatency: number;
    uptime: string;
}

const data = new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check the bot's latency, response time and additional metrics")

async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  try {
    await interaction.reply({ content: "Pinging..." });
    const sent = await interaction.fetchReply() as Message;
    
    const metrics = await calculateMetrics(interaction, sent);
    const embed = createPingEmbed(metrics, interaction);
    const row = createButtonRow();

    await interaction.editReply({
      content: null,
      embeds: [embed],
      components: [row],
    });

    setupButtonCollector(interaction, row);
  } catch (error) {
    console.error("Error in ping command:", error);
    await handlePingError(interaction, error);
  }
}

async function calculateMetrics(
    interaction: ChatInputCommandInteraction,
    sent: Message
): Promise<PingMetrics> {
    const roundTripLatency = sent.createdTimestamp - interaction.createdTimestamp;
    const websocketLatency = interaction.client.ws.ping;
    const uptime = formatUptime(process.uptime());

    return {
        roundTripLatency,
        websocketLatency,
        uptime
    };
}

function getLatencyStatus(latency: number): LatencyStatus {
    if (latency < 0) return { emoji: "🔴", status: "Error", color: 0xff0000 };
    if (latency < 100) return { emoji: "🟢", status: "Excellent", color: 0x00ff00 };
    if (latency < 200) return { emoji: "🟡", status: "Good", color: 0xffff00 };
    if (latency < 500) return { emoji: "🟠", status: "Fair", color: 0xff8000 };
    return { emoji: "🔴", status: "Poor", color: 0xff0000 };
}

function createPingEmbed(metrics: PingMetrics, interaction: ChatInputCommandInteraction): EmbedBuilder {
    const roundTripStatus = getLatencyStatus(metrics.roundTripLatency);
    const websocketStatus = getLatencyStatus(metrics.websocketLatency);

    return new EmbedBuilder()
        .setTitle("Ping Statistics")
        .addFields(
            { name: "Round Trip Latency", value: `${roundTripStatus.emoji} ${roundTripStatus.status} (${metrics.roundTripLatency}ms)`, inline: true },
            { name: "WebSocket Latency", value: `${websocketStatus.emoji} ${websocketStatus.status} (${metrics.websocketLatency}ms)`, inline: true },
        )
        .setColor(roundTripStatus.color)
        .setTimestamp()
        .setFooter({
            text: `Request by ${interaction.user.tag}`,
            iconURL: interaction.user.displayAvatarURL(),
        });
}

function createButtonRow(): ActionRowBuilder<ButtonBuilder> {
    const refreshButton = new ButtonBuilder()
        .setCustomId("ping_refresh")
        .setLabel("Refresh")
        .setEmoji("🔄")
        .setStyle(ButtonStyle.Secondary);

    return new ActionRowBuilder<ButtonBuilder>().addComponents(refreshButton);    
}

function setupButtonCollector(
    interaction: ChatInputCommandInteraction,
    row: ActionRowBuilder<ButtonBuilder>
): void {
    const collector = interaction.channel?.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000
    });

    collector?.on("collect", async (buttonInteraction: ButtonInteraction) => {
        await buttonInteraction.deferUpdate();

        try {
            const newMetrics = await calculateRefreshMetrics(buttonInteraction);
            const newEmbed = createRefreshEmbed(newMetrics, interaction);

            await buttonInteraction.editReply({
                embeds: [newEmbed],
                components: [row]
            });
        } catch (error) {
            console.error("Error refreshing ping:", error);
        }
    });

    collector?.on("end", async () => {
        try {
            const disabledButton = ButtonBuilder.from(row.components[0])
                .setDisabled(true);

            const disabledRow = new ActionRowBuilder<ButtonBuilder>()
                .addComponents(disabledButton);
                
            await interaction.editReply({
                components: [disabledRow]
            });    
        } catch (error) {
            console.error('Error disabled button:', error);
        }
    });
}

async function calculateRefreshMetrics(
    buttonInteraction: ButtonInteraction
): Promise<PingMetrics>  {
    const roundTripLatency = Date.now() - buttonInteraction.createdTimestamp;
    const websocketLatency = buttonInteraction.client.ws.ping;
    const uptime = formatUptime(process.uptime());

    return {
        roundTripLatency,
        websocketLatency,
        uptime
    };
}

function createRefreshEmbed(metrics: PingMetrics, interaction: ChatInputCommandInteraction): EmbedBuilder {
    const roundTripStatus = getLatencyStatus(metrics.roundTripLatency);
    const websocketStatus = getLatencyStatus(metrics.websocketLatency);

        return new EmbedBuilder()
        .setTitle("Ping Statistics")
        .addFields(
            { name: "Round Trip Latency", value: `${roundTripStatus.emoji} ${roundTripStatus.status} (${metrics.roundTripLatency}ms)`, inline: true },
            { name: "WebSocket Latency", value: `${websocketStatus.emoji} ${websocketStatus.status} (${metrics.websocketLatency}ms)`, inline: true },
        )
        .setColor(roundTripStatus.color)
        .setTimestamp()
        .setFooter({
            text: `Request by ${interaction.user.tag}`,
            iconURL: interaction.user.displayAvatarURL(),
        });
}

async function handlePingError(
  interaction: ChatInputCommandInteraction,
  error: unknown
): Promise<void> {
  const errorEmbed = new EmbedBuilder()
    .setTitle("❌ Error")
    .setDescription("Failed to execute ping command")
    .setColor(0xff0000)
    .setTimestamp();

  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ embeds: [errorEmbed], ephemeral: true });
    } else {
      await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
    }
  } catch (followUpError) {
    console.error("Failed to send error message:", followUpError);
  }
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0) parts.push(`${secs}s`);

  return parts.join(" ") || "0s";
}

export default { data, execute };