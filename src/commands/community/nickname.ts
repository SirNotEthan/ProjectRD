import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  GuildMember,
  PermissionFlagsBits,
  User,
} from "discord.js";
import type { ColorResolvable } from "discord.js";

interface NicknameResult {
  success: boolean;
  oldNickname: string | null;
  newNickname: string | null;
  user: string;
  targetUser?: string;
  moderator?: string;
  reason?: string;
  errorReason?: string;
  isModAction?: boolean;
}

const data = new SlashCommandBuilder()
  .setName("nickname")
  .setDescription("Set your own nickname or manage others (with permissions)")
  .addStringOption((option) =>
    option
      .setName("nickname")
      .setDescription("The nickname to set (leave empty to clear)")
      .setRequired(false)
      .setMaxLength(32)
  )
  .addUserOption((option) =>
    option
      .setName("user")
      .setDescription("The user whose nickname to change (requires moderator role)")
      .setRequired(false)
  )
  .addStringOption((option) =>
    option
      .setName("reason")
      .setDescription("Reason for the nickname change (moderator actions only)")
      .setRequired(false)
      .setMaxLength(256)
  );

function isValidNickname(nickname: string): boolean {
  const allowedPattern = /^[a-zA-Z0-9\s\-_]+$/;

  if (!allowedPattern.test(nickname)) {
    return false;
  }

  for (let i = 0; i < nickname.length; i++) {
    const charCode = nickname.charCodeAt(i);

    if (
      (charCode >= 0x1d400 && charCode <= 0x1d7ff) ||
      (charCode >= 0x1f100 && charCode <= 0x1f1ff) ||
      (charCode >= 0x2100 && charCode <= 0x214f) ||
      (charCode >= 0xff00 && charCode <= 0xffef) ||
      (charCode >= 0x0400 && charCode <= 0x04ff) ||
      (charCode >= 0x0370 && charCode <= 0x03ff)
    ) {
      return false;
    }
  }

  return true;
}

async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    if (!interaction.guild) {
      return await sendErrorResponse(interaction, "This command can only be used in a server.");
    }

    const member = interaction.member as GuildMember;
    const targetUser = interaction.options.getUser("user");
    const newNickname = interaction.options.getString("nickname");
    const reason = interaction.options.getString("reason") || "No reason provided";

    if (newNickname && !isValidNickname(newNickname)) {
      return await sendErrorResponse(
        interaction,
        "Invalid nickname. Only letters, numbers, spaces, underscores, and hyphens are allowed."
      );
    }

    if (!member) {
      return await sendErrorResponse(interaction, "Could not find your member information.");
    }

    if (targetUser && targetUser.id !== member.id) {
      const allowedRoles = ["Ethan"];
      const hasModeratorRole = member.roles.cache.some((role) =>
        allowedRoles.some((allowedRole) =>
          role.name.toLowerCase().includes(allowedRole.toLowerCase())
        )
      );

      const isServerOwner = member.id === interaction.guild.ownerId;
      if (
        !hasModeratorRole &&
        !member.permissions.has(PermissionFlagsBits.ManageNicknames) &&
        !isServerOwner
      ) {
        return await sendErrorResponse(
          interaction,
          "You don't have permission to manage other users' nicknames. You need a moderator role or the 'Manage Nicknames' permission."
        );
      }

      const botMember = interaction.guild.members.me;
      if (!botMember?.permissions.has(PermissionFlagsBits.ManageNicknames)) {
        return await sendErrorResponse(
          interaction,
          "I don't have permission to manage nicknames. Please ask an administrator to grant me the 'Manage Nicknames' permission."
        );
      }

      const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      if (!targetMember) {
        return await sendErrorResponse(interaction, "Could not find that user in this server.");
      }

      if (!targetMember.manageable) {
        return await sendErrorResponse(
          interaction,
          `I cannot change ${targetUser.tag}'s nickname due to role hierarchy. Their highest role is equal to or higher than mine.`
        );
      }

      if (
        member.roles.highest.position <= targetMember.roles.highest.position &&
        member.id !== interaction.guild.ownerId
      ) {
        return await sendErrorResponse(
          interaction,
          "You cannot change the nickname of someone with an equal or higher role."
        );
      }

      const result = await changeNickname(targetMember, newNickname, member.user.tag, reason, true);

      if (result.success) {
        await interaction.reply({
          content: "Nickname updated.",
          ephemeral: true,
        });

        await sendToLoggingChannel(interaction, result);
      } else {
        const embed = createNicknameEmbed(result, interaction);
        await interaction.reply({
          embeds: [embed],
          ephemeral: true,
        });
      }
    } else {
      const targetMember = targetUser
        ? await interaction.guild.members.fetch(targetUser.id).catch(() => null)
        : member;
      if (!targetMember) {
        return await sendErrorResponse(interaction, "Could not find user information.");
      }

      if (member.id === interaction.guild.ownerId && targetMember.id === member.id) {
        const result = await changeNickname(
          targetMember,
          newNickname,
          undefined,
          undefined,
          false,
          true
        );
        const embed = createNicknameEmbed(result, interaction);

        await interaction.reply({
          embeds: [embed],
          ephemeral: true,
        });
      } else {
        const result = await changeNickname(targetMember, newNickname);
        const embed = createNicknameEmbed(result, interaction);

        await interaction.reply({
          embeds: [embed],
          ephemeral: true,
        });
      }
    }
  } catch (error) {
    console.error("Error in nickname command:", error);
    await handleNicknameError(interaction, error);
  }
}

async function changeNickname(
  member: GuildMember,
  newNickname: string | null,
  moderator?: string,
  reason?: string,
  isModAction?: boolean,
  isServerOwner?: boolean
): Promise<NicknameResult> {
  const oldNickname = member.nickname;

  try {
    const auditLogReason =
      isModAction && moderator ? `Changed by ${moderator}: ${reason}` : undefined;
    await member.setNickname(newNickname, auditLogReason);

    return {
      success: true,
      oldNickname,
      newNickname,
      user: member.user.tag,
      targetUser: isModAction ? member.user.tag : undefined,
      moderator,
      reason,
      isModAction,
    };
  } catch (error: any) {
    console.error("Failed to change nickname:", error);

    let errorReason = "Unknown error occurred";
    if (error.code === 50013) {
      if (isServerOwner) {
        errorReason =
          "Server owners cannot change their own nicknames through bots. You'll need to change it manually through Discord's interface.";
      } else {
        errorReason = isModAction
          ? "Missing permissions or role hierarchy prevents this action"
          : "You don't have permission to change your nickname in this server";
      }
    } else if (error.code === 50035) {
      errorReason = "Invalid nickname (too long or contains forbidden characters)";
    } else if (error.code === 50001) {
      errorReason = "Missing access to perform this action";
    }

    return {
      success: false,
      oldNickname,
      newNickname,
      user: member.user.tag,
      targetUser: isModAction ? member.user.tag : undefined,
      moderator,
      reason,
      isModAction,
      errorReason,
    };
  }
}

function createNicknameEmbed(
  result: NicknameResult,
  interaction: ChatInputCommandInteraction
): EmbedBuilder {
  const embed = new EmbedBuilder().setTimestamp().setFooter({
    text: `${result.isModAction ? "Action" : "Request"} by ${interaction.user.tag}`,
    iconURL: interaction.user.displayAvatarURL(),
  });

  if (result.success) {
    if (result.isModAction) {
      if (result.newNickname) {
        embed
          .setTitle("🔧 Nickname Updated")
          .setDescription(
            `**${result.targetUser}**'s nickname has been changed to **${result.newNickname}**`
          )
          .setColor(0x00ff00);
      } else {
        embed
          .setTitle("🔧 Nickname Cleared")
          .setDescription(`**${result.targetUser}**'s nickname has been cleared`)
          .setColor(0x00ff00);
      }

      const fields = [];

      if (result.oldNickname) {
        fields.push({
          name: "Previous Nickname",
          value: result.oldNickname,
          inline: true,
        });
      }

      if (result.moderator) {
        fields.push({
          name: "Moderator",
          value: result.moderator,
          inline: true,
        });
      }

      if (result.reason) {
        fields.push({
          name: "Reason",
          value: result.reason,
          inline: false,
        });
      }

      embed.addFields(fields);
    } else {
      if (result.newNickname) {
        embed
          .setTitle("✅ Nickname Updated")
          .setDescription(`Your nickname has been changed to **${result.newNickname}**`)
          .setColor(0x00ff00);

        if (result.oldNickname) {
          embed.addFields({
            name: "Previous Nickname",
            value: result.oldNickname,
            inline: true,
          });
        }
      } else {
        embed
          .setTitle("✅ Nickname Cleared")
          .setDescription("Your nickname has been cleared")
          .setColor(0x00ff00);

        if (result.oldNickname) {
          embed.addFields({
            name: "Previous Nickname",
            value: result.oldNickname,
            inline: true,
          });
        }
      }
    }
  } else {
    let description = result.isModAction
      ? `Could not change **${result.targetUser}**'s nickname.`
      : "Could not change your nickname.";

    if (result.errorReason) {
      description += ` Reason: ${result.errorReason}`;
    }

    embed.setTitle("❌ Failed to Update Nickname").setDescription(description).setColor(0xff0000);
  }

  return embed;
}

async function sendToLoggingChannel(
  interaction: ChatInputCommandInteraction,
  result: NicknameResult
): Promise<void> {
  try {
    const logChannelNames = ["logs", "mod-logs", "moderation-logs", "audit-logs", "staff-logs"];
    let logChannel = null;

    for (const channelName of logChannelNames) {
      logChannel = interaction.guild?.channels.cache.find(
        (channel) => channel.name === channelName && channel.isTextBased()
      );
      if (logChannel) break;
    }

    if (logChannel && logChannel.isTextBased()) {
      const embed = createNicknameEmbed(result, interaction);
      await logChannel.send({ embeds: [embed] });
    } else {
      console.log(
        `🔧 Nickname changed by ${result.moderator}: ${result.targetUser} -> "${
          result.newNickname || "cleared"
        }" (Reason: ${result.reason})`
      );
    }
  } catch (error) {
    console.error("Failed to send to logging channel:", error);
    console.log(
      `🔧 Nickname changed by ${result.moderator}: ${result.targetUser} -> "${
        result.newNickname || "cleared"
      }" (Reason: ${result.reason})`
    );
  }
}

async function handleNicknameError(
  interaction: ChatInputCommandInteraction,
  error: unknown
): Promise<void> {
  const errorEmbed = new EmbedBuilder()
    .setTitle("❌ Error")
    .setDescription("Failed to execute nickname command")
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
      await interaction.followUp({ embeds: [errorEmbed], ephemeral: true });
    } else {
      await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
    }
  } catch (replyError) {
    console.error("Failed to send error response:", replyError);
  }
}

export default { data, execute };
