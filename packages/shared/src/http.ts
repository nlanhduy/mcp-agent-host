/**
 * Shared plumbing for the two Streamable-HTTP MCP servers.
 *
 * Both `server-local-http` and `server-public-http` speak the same transport;
 * the only difference is that the public one puts an API-key check in front.
 * Keeping the session handling here means that logic is written and debugged
 * once.
 */

import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

/** Compares two secrets without leaking their contents through timing. */
export function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, so equalise first. The length
  // itself is not secret.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Express middleware enforcing `Authorization: Bearer <apiKey>`.
 * Responds with a JSON-RPC shaped error so MCP clients render it sensibly.
 */
export function requireBearerToken(apiKey: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? "";
    const [scheme, token] = header.split(" ");

    if (scheme?.toLowerCase() !== "bearer" || !token) {
      res
        .status(401)
        .set("WWW-Authenticate", 'Bearer realm="mcp"')
        .json(jsonRpcError(-32001, "Missing 'Authorization: Bearer <api-key>' header."));
      return;
    }

    if (!secretsMatch(token, apiKey)) {
      res.status(401).json(jsonRpcError(-32001, "Invalid API key."));
      return;
    }

    next();
  };
}

function jsonRpcError(code: number, message: string) {
  return { jsonrpc: "2.0", error: { code, message }, id: null };
}

export interface HttpMcpOptions {
  /** Called for every new session; returns a freshly configured server. */
  createServer: () => McpServer;
  port: number;
  serverName: string;
  /** Optional middleware (e.g. auth) applied to /mcp only. */
  guard?: ReturnType<typeof requireBearerToken>;
}

/**
 * Boots an Express app exposing the standard MCP Streamable HTTP endpoints:
 *
 *   POST   /mcp   client -> server messages (and session initialisation)
 *   GET    /mcp   server -> client SSE stream for the session
 *   DELETE /mcp   explicit session teardown
 *   GET    /health unauthenticated liveness probe
 *
 * Sessions are stateful: `initialize` mints a session id which the client then
 * echoes back in `Mcp-Session-Id`. This is the mode MCP Inspector exercises.
 */
export function startHttpMcpServer(options: HttpMcpOptions) {
  const { createServer, port, serverName, guard } = options;
  const app = express();
  app.use(express.json({ limit: "4mb" }));

  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", server: serverName, sessions: transports.size });
  });

  const mcpRouter = express.Router();
  if (guard) mcpRouter.use(guard);

  mcpRouter.post("/", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      if (!isInitializeRequest(req.body)) {
        res
          .status(400)
          .json(jsonRpcError(-32000, "No valid session. Send an 'initialize' request first."));
        return;
      }

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, transport!);
        },
      });

      // Drop the session from the map when the client disconnects, otherwise
      // long-running deployments leak a transport per reconnect.
      transport.onclose = () => {
        if (transport?.sessionId) transports.delete(transport.sessionId);
      };

      await createServer().connect(transport);
    }

    await transport.handleRequest(req, res, req.body);
  });

  // GET opens the SSE stream, DELETE tears the session down. Both require an
  // established session id.
  const withSession = async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      res.status(400).json(jsonRpcError(-32000, "Unknown or missing Mcp-Session-Id."));
      return;
    }
    await transport.handleRequest(req, res);
  };

  mcpRouter.get("/", withSession);
  mcpRouter.delete("/", withSession);

  app.use("/mcp", mcpRouter);

  const http = app.listen(port, () => {
    console.error(`[${serverName}] listening on http://localhost:${port}/mcp`);
    if (guard) console.error(`[${serverName}] API key authentication is ENABLED`);
  });

  // A stale server from an earlier run is the most common startup failure, and
  // the raw EADDRINUSE stack trace does not say that. Worse, whatever is
  // already on the port keeps answering — with a different API key — so the
  // symptom shows up later as a confusing auth error in the client.
  http.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `[${serverName}] FATAL: port ${port} is already in use.\n` +
          `  Another server is still running there. Find and stop it with:\n` +
          `    lsof -ti:${port} | xargs kill -9`,
      );
    } else {
      console.error(`[${serverName}] FATAL: ${error.message}`);
    }
    process.exit(1);
  });

  const shutdown = () => {
    for (const transport of transports.values()) void transport.close();
    http.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return app;
}
