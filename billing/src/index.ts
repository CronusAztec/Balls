// The Cloudflare Worker entry point. All the logic lives in app.ts (which the tests drive directly).

import { handleRequest } from "./app";
import type { Env } from "./env";

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
