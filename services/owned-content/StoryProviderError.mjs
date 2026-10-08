export class WaitingResourceError extends Error {
  constructor(message) { super(message); this.code = "WAITING_RESOURCE"; }
}
