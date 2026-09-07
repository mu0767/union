import { solveRaidHybrid } from './planner-hybrid-engine-v3.js';

self.onmessage = async ({data}) => {
  try {
    const plan = await solveRaidHybrid(data, message => self.postMessage({progress: message}));
    self.postMessage({plan});
  } catch (error) {
    self.postMessage({error: error?.message || String(error)});
  }
};
