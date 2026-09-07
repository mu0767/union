import {solveRaid} from './planner-solver.js';
self.onmessage = async event => {
  try {
    const plan=await solveRaid(event.data,message=>self.postMessage({progress:message}));
    self.postMessage({plan});
  } catch(error) { self.postMessage({error:error.message || String(error)}); }
};
