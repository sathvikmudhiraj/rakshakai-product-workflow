export function createRefreshGate() {
  let inFlight = false;
  let pending = false;

  return {
    begin() {
      if (inFlight) {
        pending = true;
        return false;
      }
      inFlight = true;
      return true;
    },
    finish() {
      inFlight = false;
      const rerun = pending;
      pending = false;
      return rerun;
    }
  };
}
