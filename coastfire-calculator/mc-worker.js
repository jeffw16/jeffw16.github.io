// Runs the Monte Carlo risk calculation off the main thread.
// Messages in: { id, inputs }. Messages out: { id, risk }.
import { createRiskRunner } from "./risk.js?v=39091f289f";

const run = createRiskRunner();

self.onmessage = (event) => {
  const { id, inputs } = event.data;
  self.postMessage({ id, risk: run(inputs) });
};
