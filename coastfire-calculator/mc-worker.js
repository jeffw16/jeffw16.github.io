// Runs the Monte Carlo risk calculation off the main thread.
// Messages in: { id, inputs }. Messages out: { id, risk }.
import { createRiskRunner } from "./risk.js?v=a26466d225";

const run = createRiskRunner();

self.onmessage = (event) => {
  const { id, inputs } = event.data;
  self.postMessage({ id, risk: run(inputs) });
};
