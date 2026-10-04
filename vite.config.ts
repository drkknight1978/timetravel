import { defineConfig, loadEnv, type Plugin } from "vite";
import { createNpcAIService } from "./server/npc-ai.ts";
import { createConversationService } from "./server/conversation.ts";

export default defineConfig(({ mode }) => {
  // loadEnv's empty prefix is used only on the server. No key is exposed via
  // Vite's define/envPrefix, the browser bundle, status output or log messages.
  const local = loadEnv(mode, process.cwd(), "");
  const env = { ...local, ...process.env };
  const service = createNpcAIService({ env });
  const conversations = createConversationService({ env });
  const npcAI: Plugin = {
    name: "local-npc-intelligence",
    configureServer(server) {
      server.middlewares.use(service.middleware);
      server.middlewares.use(conversations.middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(service.middleware);
      server.middlewares.use(conversations.middleware);
    },
  };
  return { plugins: [npcAI] };
});
