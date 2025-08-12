import { Events, Client, ActivityType } from 'discord.js';

export default {
    name: Events.ClientReady,
    once: true,
    async execute(client: Client) {
        console.log(`Logged in as ${client.user?.tag}!`);
        
        await client.user?.setActivity('your server', { type: ActivityType.Watching });
    },
    async onError(error: Error) {
        console.error('An error occurred:', error);
    }
}