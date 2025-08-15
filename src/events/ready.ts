import { Events, Client, ActivityType } from 'discord.js';

export const name = Events.ClientReady;
export const once = true;

export async function execute(client: Client<true>) {
    console.log(`Logged in as ${client.user?.tag}!`);
    
    client.user?.setActivity('Admiring the wonderful work', { type: ActivityType.Custom });
}