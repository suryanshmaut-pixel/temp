import { auth } from "@test-evals/auth";
import { env } from "@test-evals/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { z } from "zod";

import { runnerService } from "./services/runner.instance";

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

const startRunSchema = z.object({
  strategy: z.enum(["zero_shot", "few_shot", "cot"]),
  model: z.enum(["claude-haiku-4-5-20251001", "llama-3.1-8b-instant"]).optional(),
  dataset_filter: z
    .object({
      caseIds: z.array(z.string()).optional(),
      limit: z.number().int().nonnegative().optional(),
      offset: z.number().int().nonnegative().optional(),
    })
    .optional(),
  force: z.boolean().optional(),
});

app.post("/api/v1/runs", async (c) => {
  const body = startRunSchema.parse(await c.req.json());
  const run = await runnerService.startRun(body);
  return c.json(run, 202);
});

app.get("/api/v1/runs", async (c) => {
  return c.json(await runnerService.listRuns());
});

app.get("/api/v1/runs/compare", async (c) => {
  const left = c.req.query("left");
  const right = c.req.query("right");
  if (left === undefined || right === undefined) {
    return c.json({ error: "Both left and right run ids are required." }, 400);
  }

  const comparison = await runnerService.compareRuns(left, right);
  if (comparison === null) {
    return c.json({ error: "One or both runs were not found." }, 404);
  }
  return c.json(comparison);
});

app.get("/api/v1/runs/:id", async (c) => {
  const run = await runnerService.getRun(c.req.param("id"));
  if (run === null) {
    return c.json({ error: "Run not found." }, 404);
  }
  return c.json(run);
});

app.post("/api/v1/runs/:id/resume", async (c) => {
  const run = await runnerService.resumeRun(c.req.param("id"));
  return c.json(run, 202);
});

app.get("/api/v1/runs/:id/cases", async (c) => {
  return c.json(await runnerService.listCases(c.req.param("id")));
});

app.get("/api/v1/runs/:id/cases/:caseId", async (c) => {
  const detail = await runnerService.getCaseDetail(c.req.param("id"), c.req.param("caseId"));
  if (detail === null) {
    return c.json({ error: "Case not found." }, 404);
  }
  return c.json(detail);
});

app.get("/api/v1/runs/:id/events", (c) => {
  const runId = c.req.param("id");
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;

  const stream = new ReadableStream({
    start(controller) {
      unsubscribe = runnerService.subscribe(runId, (event) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      });
      controller.enqueue(encoder.encode(": connected\n\n"));
    },
    cancel() {
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

app.get("/", (c) => {
  return c.text("OK");
});

export default app;
