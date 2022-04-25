import { VError } from 'verror';

export default abstract class PongError extends VError {
  get name(): string {
    return this.constructor.name;
  }
}
