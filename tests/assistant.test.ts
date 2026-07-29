import assert from "node:assert/strict";
import test from "node:test";
import { generalAssistantFallback } from "../lib/assistant.ts";

const context = {
  now: "martes, 28 de julio de 2026, 10:00",
  synchronized: true,
  fetchedAt: "28/7/26, 10:00",
  operations: 120,
  weeks: 3,
  completedOperations: 8,
  mappedOperations: 100,
  blockedOperations: 12,
  shortages: 20,
  stockItems: 1600,
  changes: { added: 2, modified: 1, removed: 0, detectedAt: "" },
};

test("responde la fecha como consulta general", () => {
  assert.match(generalAssistantFallback("¿Qué día es hoy?", context), /28 de julio/);
});

test("explica los cambios sin buscar códigos puntuales", () => {
  const answer = generalAssistantFallback("¿Qué cambió?", context);
  assert.match(answer, /2 operaciones agregadas/);
  assert.match(answer, /1 modificadas/);
});
