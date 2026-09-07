import { solveRaidHybrid } from './planner-hybrid-engine.js';

self.onmessage = async ({data}) => {
  try {
    const plan = await solveRaidHybrid(data, message => self.postMessage({progress: message}));
    self.postMessage({plan});
  } catch (error) {
    self.postMessage({error: error?.message || String(error)});
  }
};
