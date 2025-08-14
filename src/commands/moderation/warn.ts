import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  GuildMember,
} from "discord.js";
import database, { InfractionType } from "../../database/database";

interface WarnResult {
  success: boolean;
  user: string;
  targetUser?: string;
  moderator?: string;
  reason?: string;
  infractionId?: string;
  errorReason?: string;
  evidence?: { url: string };
}

const data = new SlashCommandBuilder()
  .setName("warn")
  .setDescription("Warn a user in the server")
  .addUserOption((option) =>
    option.setName("target").setDescription("The user to warn").setRequired(true)
  )
  .addStringOption((option) =>
    option.setName("reason").setDescription("The reason for the warning").setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("evidence")
      .setDescription("Evidence URL link for the warning")
      .setRequired(false)
  );

async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    if (!interaction.guild) {
      return await sendErrorResponse(interaction, "This command can only be used in a server.");
    }

    const member = interaction.member as GuildMember;
    const targetUser = interaction.options.getUser("target");
    const reason = interaction.options.getString("reason");

    if (!member) {
      return await sendErrorResponse(interaction, "Issue getting the sending member.");
    }

    if (!targetUser) {
      return await sendErrorResponse(interaction, "Please specify a user to warn.");
    }

    if (!reason) {
      return await sendErrorResponse(interaction, "Please input a reason for the warning.");
    }

    const allowedRoles = [
      "Community Moderator",
      "Trial Community Moderator",
      "Trial VC Moderator",
      "VC Moderator",
      "Community Manager",
      "Administrator",
    ];
    const hasAllowedRole = member.roles.cache.some((role) =>
      allowedRoles.some((allowedRole) =>
        role.name.toLowerCase().includes(allowedRole.toLowerCase())
      )
    );

    if (!hasAllowedRole) {
      return await sendErrorResponse(interaction, "You don't have permission to warn users.");
    }

    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      return await sendErrorResponse(interaction, "Could not find that user in this server.");
    }

    if (!targetMember.manageable) {
      return await sendErrorResponse(
        interaction,
        `I cannot warn ${targetUser.tag} due to role hierarchy. Their highest role is equal to or higher than mine.`
      );
    }

    if (
      member.roles.highest.position <= targetMember.roles.highest.position &&
      member.id !== interaction.guild.ownerId
    ) {
      return await sendErrorResponse(
        interaction,
        "You cannot warn someone with an equal or higher role."
      );
    }
    const evidence = interaction.options.getString("evidence") || undefined;
    const result = await warnUser(targetMember, reason, member.user.tag, interaction, evidence);

    if (result.success) {
      await interaction.reply({
        content: `Successfully warned ${targetUser.tag}\nReason: ${reason} Infraction ID: \`${result.infractionId}\``,
        ephemeral: false,
      });

      await sendToLoggingChannel(interaction, result);
      await sendWarnMessageToUser(
        targetMember,
        reason,
        member.user.tag,
        interaction,
        result.infractionId
      );
    } else {
      await sendErrorResponse(interaction, result.errorReason || "Failed to warn user.");
    }
  } catch (error) {
    console.error("Error executing warn command:", error);
    await sendErrorResponse(interaction, "An error occurred while executing the command.");
  }
}

async function warnUser(
  targetMember: GuildMember,
  reason: string,
  moderator: string,
  interaction: ChatInputCommandInteraction,
  evidence?: string
): Promise<WarnResult> {
  try {
    if (!interaction.guild) {
      return {
        success: false,
        user: targetMember.user.tag,
        errorReason: "Guild information not available.",
      };
    }

    const infractionId = database.addWarning(
      targetMember.user.id,
      interaction.guild.id,
      interaction.user.id,
      reason
    );

    return {
      success: true,
      user: targetMember.user.tag,
      targetUser: targetMember.user.tag,
      moderator,
      reason,
      infractionId,
      evidence: evidence ? { url: evidence } : undefined,
    };
  } catch (error) {
    console.error("Error warning user:", error);
    return {
      success: false,
      user: targetMember.user.tag,
      errorReason: "Failed to save warning to database.",
    };
  }
}

async function sendToLoggingChannel(
  interaction: ChatInputCommandInteraction,
  result: WarnResult
): Promise<void> {
  try {
    if (!interaction.guild) return;

    const logChannelNames = [
      "logs",
      "mod-logs",
      "moderation-logs",
      "audit-logs",
      "staff-logs",
      "mod-log",
    ];
    let logChannel = null;

    for (const channelName of logChannelNames) {
      logChannel = interaction.guild.channels.cache.find(
        (channel) => channel.name === channelName && channel.isTextBased()
      );
      if (logChannel) break;
    }

    if (logChannel && logChannel.isTextBased()) {
      const logEmbed = new EmbedBuilder()
        .setTitle("User Warned")
        .setDescription(`Reason: ${result.reason}`)
        .addFields(
          { name: "User", value: result.targetUser ?? result.user ?? "-", inline: true },
          { name: "Moderator", value: result.moderator ?? "-", inline: true }
        )
        .setColor(0xffcc00)
        .setTimestamp()
        .setFooter({
          text: `Infraction ID ${result.infractionId}`,
        });

      if (result.evidence) {
        logEmbed.addFields({
          name: "Evidence",
          value: `[View Evidence](${result.evidence.url})`,
          inline: false,
        });
      }

      await logChannel.send({ embeds: [logEmbed] });
    } else {
      console.log(
        `🔺 User warned by ${result.moderator}: ${result.targetUser ?? result.user} (Reason: ${
          result.reason
        })`
      );
    }
  } catch (error) {
    console.error("Failed to send to logging channel:", error);
    console.log(
      `🔺 User warned by ${result.moderator}: ${result.targetUser ?? result.user} (Reason: ${
        result.reason
      })`
    );
  }
}

async function sendWarnMessageToUser(
  targetMember: GuildMember,
  reason: string,
  moderator: string,
  interaction: ChatInputCommandInteraction,
  infractionId?: string
): Promise<void> {
  try {
    const warnEmbed = new EmbedBuilder()
      .setTitle(`Official Warning in ${interaction.guild?.name}`)
      .setDescription(`${reason}`)
      .addFields(
        {
          name: "Infraction ID",
          value: infractionId ? `${infractionId}` : "Unknown",
          inline: true,
        },
        { name: "Issued by", value: moderator, inline: false },
        { name: "Date", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
      )
      .setColor(0xff6b35)
      .setTimestamp()
      .setThumbnail(targetMember.user.displayAvatarURL())
      .setFooter({
        text: `Warning issued in ${interaction.guild?.name}`,
        iconURL: interaction.guild?.iconURL() || undefined,
      });

    const evidence = interaction.options.getString("evidence");
    if (evidence) {
      warnEmbed.addFields({
        name: "Evidence",
        value: `[View Evidence](${evidence})`,
        inline: false,
      });
    }

    await targetMember.send({ embeds: [warnEmbed] });

    const appealEmbed = new EmbedBuilder()
      .setTitle("Appeal Information")
      .setDescription(
        "If you believe this warning was issued in error, you can appeal it by making a ticket."
      )
      .addFields(
        {
          name: "How to Appeal",
          value: "Contact a server administrator or moderator to discuss your warning.",
          inline: false,
        },
        {
          name: "Appeal Guidelines",
          value:
            "• Be respectful in your appeal\n• Provide any relevant context\n• Wait for a response before sending follow-ups",
          inline: false,
        }
      )
      .setColor(0x0099ff)
      .setFooter({ text: "Appeals are reviewed on a case-by-case basis" });

    await targetMember.send({ embeds: [appealEmbed] });
  } catch (error) {
    console.error("Failed to send warning message to user:", error);
  }
}

async function sendErrorResponse(
  interaction: ChatInputCommandInteraction,
  message: string
): Promise<void> {
  const errorEmbed = new EmbedBuilder()
    .setTitle("❌ Error")
    .setDescription(message)
    .setColor(0xff0000)
    .setTimestamp();

  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ embeds: [errorEmbed] });
    } else {
      await interaction.reply({ embeds: [errorEmbed] });
    }
  } catch (replyError) {
    console.error("Failed to send error response:", replyError);
  }
}

export default { data, execute };
