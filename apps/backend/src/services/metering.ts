import type { MeteringSink } from '../contracts/infrastructure.js';

export const noopMeteringSink: MeteringSink = {
  async record() {
    return undefined;
  },
};
