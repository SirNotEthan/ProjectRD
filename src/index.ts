import { REST, Routes, Client, GatewayIntentBits, Collection } from 'discord.js';
import { config } from 'dotenv';
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';
import database from './database/database';
config();

declare module 'discord.js' {
  export interface Client {
    commands: Collection<string, any>;
    buttons: Collection<string, any>;
    modals: Collection<string, any>;
    selectMenus: Collection<string, any>;
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ]
});

client.commands = new Collection();
client.buttons = new Collection();
client.modals = new Collection();
client.selectMenus = new Collection();

async function loadCommands(): Promise<void> {
  const commandsPath = join(__dirname, 'commands');
  try {
    const commandFolders = readdirSync(commandsPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    console.log(`Loading commands from folders: ${commandFolders.join(', ')}`);
    
    for (const folder of commandFolders) {
      const folderPath = join(commandsPath, folder);
      const commandFiles = readdirSync(folderPath)
        .filter(file => file.endsWith('.ts') || file.endsWith('.js'));
        
      for (const file of commandFiles) {
        const filePath = join(folderPath, file);
        const command = await import(filePath);
        if ('data' in command.default && 'execute' in command.default) {
          client.commands.set(command.default.data.name, command.default);
          console.log(`Loaded command: ${command.default.data.name} from ${filePath}`);
        } else {
          console.warn(`Command in ${filePath} is missing required properties.`);
        }
      }  
    }
    console.log(`Loaded ${client.commands.size} commands.`);
  } catch (error) {
    console.error(`Error loading commands: ${error}`);
  }
}

async function loadEvents(): Promise<void> {
  const eventsPath = join(__dirname, 'events');
  try {
    if (!existsSync(eventsPath)) {
      console.log('Events directory not found. Skipping event loading.');
      return;
    }
    const eventFiles = readdirSync(eventsPath).filter(file => file.endsWith('.ts') || file.endsWith('.js'));

      for (const file of eventFiles) {
        const filePath = join(eventsPath, file);
        const event = await import(filePath);

        if ('name' in event && 'execute' in event) {
          if (event.once) {
            client.once(event.name, (...args) => event.execute(...args));
          } else {
            client.on(event.name, (...args) => event.execute(...args));
          }
          console.log(`Loaded Event: ${event.name} (${event.once ? 'once' : 'on'})`);
        } else {
          console.log(`Event at ${filePath} is missing required properties.`);
        }
      }
      console.log(`Total Events Loaded: ${eventFiles.length}`);
    } catch (error) {
      console.error('Error loading events:', error);
    }
  }

async function loadInteractions(): Promise<void> {
  const interactionsPath = join(__dirname, 'interactions');
  try {
    await loadButtons(interactionsPath);
    await loadModals(interactionsPath);
    await loadSelectMenus(interactionsPath);

    console.log(`Total interactions loaded: ${client.buttons.size + client.modals.size + client.selectMenus.size}`);
  } catch (error) {
    console.error('Error loading interactions:', error);
  }
}

async function loadButtons(interactionsPath: string): Promise<void> {
    const buttonsPath = join(interactionsPath, 'buttons');
    if (existsSync(buttonsPath)) {
        const buttonFiles = readdirSync(buttonsPath).filter(file => file.endsWith('.ts') || file.endsWith('.js'));
        for (const file of buttonFiles) {
            const filePath = join(buttonsPath, file);
            const button = await import(filePath);

            if ('customId' in button.default && 'execute' in button.default) {
                client.buttons.set(button.default.customId, button.default);
                console.log(`Loaded button: ${button.default.customId} from ${filePath}`);
            }
        }
    }
}

async function loadModals(interactionsPath: string): Promise<void> {
    const modalsPath = join(interactionsPath, 'modals');
    if (existsSync(modalsPath)) {
        const modalFiles = readdirSync(modalsPath).filter(file => file.endsWith('.ts') || file.endsWith('.js'));
        for (const file of modalFiles) {
            const filePath = join(modalsPath, file);
            const modal = await import(filePath);

            if ('customId' in modal.default && 'execute' in modal.default) {
                client.modals.set(modal.default.customId, modal.default);
                console.log(`Loaded modal: ${modal.default.customId} from ${filePath}`);
            }
        }
    }
}

async function loadSelectMenus(interactionsPath: string): Promise<void> {
    const selectMenusPath = join(interactionsPath, 'selectMenus');
    if (existsSync(selectMenusPath)) {
        const selectMenuFiles = readdirSync(selectMenusPath).filter(file => file.endsWith('.ts') || file.endsWith('.js'));
        for (const file of selectMenuFiles) {
            const filePath = join(selectMenusPath, file);
            const selectMenu = await import(filePath);

            if ('customId' in selectMenu.default && 'execute' in selectMenu.default) {
                client.selectMenus.set(selectMenu.default.customId, selectMenu.default);
                console.log(`Loaded select menu: ${selectMenu.default.customId} from ${filePath}`);
            }
        }
    }
}

async function deployCommands(): Promise<void> {
    const commands = [];

    for (const command of client.commands.values()) {
        commands.push(command.data.toJSON());
    }

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN as string);

    try {
        console.log(`Started refreshing application (/) commands.`);
        const data = await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID as string),
            { body: commands }
        ) as any[];

        console.log(`Successfully reloaded ${data.length} application (/) commands.`);
    } catch (error) {
        console.error('Error deploying commands:', error);
    }
}

async function initializeBot(): Promise<void> {
    console.log('Initializing bot...');
    try {
        await loadCommands();
        await loadEvents();
        await loadInteractions();
        await client.login(process.env.DISCORD_TOKEN as string);

        client.once('ready', async () => {
            await deployCommands();
            console.log('Bot initialized successfully.');
        });
    } catch (error) {
        console.error('Error during bot initialization:', error);
        process.exit(1);
    }
}

process.on('SIGINT', () => {
    console.log('Received SIGINT. Shutting down gracefully...');
    database.close();
    client.destroy();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('Received SIGTERM. Shutting down gracefully...');
    database.close();
    client.destroy();
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    database.close();
    client.destroy();
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    database.close();
    client.destroy();
    process.exit(1);
});

initializeBot();