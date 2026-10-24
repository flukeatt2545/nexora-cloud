import { Events, type Client } from "discord.js";
import { logBotError } from "../api";

// The voice-room, mail and NEXORA bots used to be bots of their own. Their code now lives in
// this bot, one folder each, nearly as it was. Each folder's index.ts still says
// `client.on(...)` on a `client` that is a LegacyBot's stand-in: it only writes down what the
// code asked for. When the real bot is connected, attach() hands the listeners to it, except
// two kinds that the host takes over:
//   - interactions (commands, buttons, forms): the host decides which module owns each one;
//   - "ready": run once, after login, by start().
// Slash command registration, presence and the login itself belong to the host now.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (...args: any[]) => unknown;

export class LegacyBot {
  private events: { event: string; handler: Handler; once: boolean }[] = [];
  private ready: Handler[] = [];
  private real: Client | null = null;
  /** The module's InteractionCreate listener; the host calls it for what the module owns. */
  interaction: Handler | null = null;
  readonly client: Client;

  constructor(readonly name: string) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this.client = new Proxy({} as Client, {
      get(_target, prop) {
        if (prop === "on" || prop === "once") {
          return (event: string, handler: Handler) => {
            self.events.push({ event, handler, once: prop === "once" });
            return self.client;
          };
        }
        if (!self.real) throw new Error(`${name}: the bot is not connected yet (client.${String(prop)})`);
        const value = Reflect.get(self.real, prop);
        return typeof value === "function" ? value.bind(self.real) : value;
      },
    });
  }

  /** Gives the module's listeners to the connected bot. */
  attach(real: Client) {
    this.real = real;
    for (const item of this.events) {
      if (item.event === Events.InteractionCreate) this.interaction = item.handler;
      else if (item.event === Events.ClientReady) this.ready.push(item.handler);
      else if (item.once) real.once(item.event as never, item.handler as never);
      else real.on(item.event as never, item.handler as never);
    }
  }

  /** Runs what the module wanted done at login. */
  async start() {
    if (!this.real) return;
    for (const handler of this.ready) {
      try {
        await handler(this.real);
      } catch (error) {
        logBotError(`${this.name} start`, error);
      }
    }
  }
}
