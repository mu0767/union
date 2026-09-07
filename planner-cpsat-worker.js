import { solveRaidCpSat } from './planner-cpsat-engine.js';

self.onmessage = async ({data}) => {
  try {
    const plan = await solveRaidCpSat(data, message => self.postMessage({progress: message}));
    self.postMessage({plan});
  } catch (error) {
    self.postMessage({error: error?.message || String(error)});
  }
};
