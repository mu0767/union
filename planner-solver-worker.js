import * as cp from './vendor/ortools/browser/cp-sat.js';
import {solveRaid} from './planner-solver.js';
self.onmessage = async event => {
  try {
    const plan=await solveRaid(event.data,cp,message=>self.postMessage({progress:message}));
    self.postMessage({plan});
  } catch(error) { self.postMessage({error:error.message || String(error)}); }
};
